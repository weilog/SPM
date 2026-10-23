import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DbService } from "../db/db.module";
import { ProjectsService } from "../projects/projects.module";
import { userSelect } from "../common/security";
import { Prisma, AiAnalysisRun } from "../generated/prisma/client";
import { AiConfig } from "./ai.config";
import { AiContextService } from "./context.service";
import { AiProvider } from "./provider";
import { AnalysisKind, AnalysisScope, ModelResult } from "./ai.types";
import { detectRisks } from "./rules";
@Injectable()
export class AiAnalysisWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopped = false;
  private readonly logger = new Logger(AiAnalysisWorker.name);
  private polling?: Promise<void>;
  private active = new Map<
    string,
    { promise: Promise<void>; abort: AbortController }
  >();
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
    private readonly config: AiConfig,
    private readonly context: AiContextService,
    private readonly provider: AiProvider,
  ) {}
  onModuleInit() {
    if (this.config.enabled) {
      this.timer = setInterval(() => {
        if (!this.polling)
          this.polling = this.tick()
            .catch(() => {
              this.logger.error(
                "AI queue polling failed; queued work remains persisted.",
              );
            })
            .finally(() => {
              this.polling = undefined;
            });
      }, this.config.pollMs);
      this.timer.unref();
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const x of this.active.values()) x.abort.abort();
    await this.polling;
    for (const x of this.active.values()) x.abort.abort();
    await Promise.allSettled([...this.active.values()].map((x) => x.promise));
  }
  async tick() {
    if (!this.config.enabled || this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      // An expired lease is a visible failure, never an automatic second paid model call.
      await this.db.aiAnalysisRun.updateMany({
        where: { status: "RUNNING", leaseExpiresAt: { lt: new Date() } },
        data: {
          status: "FAILED",
          errorCode: "WORKER_INTERRUPTED",
          finishedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      while (!this.stopped && this.active.size < this.config.concurrency) {
        const run = await this.db.atomic(async (tx) => {
          const next = await tx.aiAnalysisRun.findFirst({
            where: { status: "QUEUED" },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          });
          if (!next) return null;
          const leaseToken = randomUUID();
          const changed = await tx.aiAnalysisRun.updateMany({
            where: { id: next.id, status: "QUEUED" },
            data: {
              status: "RUNNING",
              startedAt: new Date(),
              leaseToken,
              leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
            },
          });
          return changed.count ? { ...next, leaseToken } : null;
        });
        if (!run) break;
        const abort = new AbortController(),
          promise = this.execute(run, abort.signal).finally(() =>
            this.active.delete(run.id),
          );
        this.active.set(run.id, { promise, abort });
      }
    } finally {
      this.ticking = false;
    }
  }
  private async execute(run: AiAnalysisRun, signal: AbortSignal) {
    const lease = { id: run.id, status: "RUNNING", leaseToken: run.leaseToken };
    try {
      const actor = run.requestedById
        ? await this.db.user.findUnique({
            where: { id: run.requestedById },
            select: userSelect,
          })
        : null;
      if (!actor) throw new ForbiddenException();
      await this.projects.authorized(actor, run.projectId, true);
      const ctx = await this.context.build(
        actor,
        run.projectId,
        run.kind as AnalysisKind,
        run.scope as AnalysisScope,
      );
      const { findings, truncated } = detectRisks(
        ctx,
        run.kind as AnalysisKind,
        this.config.maxFindings,
      );
      let result: ModelResult;
      if (this.config.configured()) {
        const reserved = await this.db.atomic(async (tx) => {
          await this.projects.authorized(actor, run.projectId, true, tx);
          if (
            (await tx.aiAnalysisRun.count({
              where: {
                projectId: run.projectId,
                modelAttemptedAt: { gte: new Date(Date.now() - 86400000) },
              },
            })) >= this.config.maxCalls24h
          )
            return false;
          return (
            (
              await tx.aiAnalysisRun.updateMany({
                where: lease,
                data: { modelAttemptedAt: new Date() },
              })
            ).count === 1
          );
        });
        result = reserved
          ? await this.provider.explain(findings, signal)
          : { state: "BUDGET_EXCEEDED", explanations: [], info: {} };
      } else result = await this.provider.explain(findings, signal);
      if (signal.aborted) throw new Error("WORKER_STOPPED");
      await this.db.atomic(async (tx) => {
        await this.projects.authorized(actor, run.projectId, true, tx);
        const saved = await tx.aiAnalysisRun.updateMany({
          where: lease,
          data: {
            status:
              result.state === "SUCCEEDED" && !truncated
                ? "COMPLETED"
                : "PARTIAL",
            sourceHash: ctx.hash,
            sourceDate: ctx.asOf,
            modelState: result.state,
            modelInfo: { ...result.info, rulesTruncated: truncated },
            errorCode: truncated ? "RULE_OUTPUT_LIMIT" : null,
            finishedAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (!saved.count) return;
        for (const f of findings) {
          const explanation = result.explanations.find(
            (e) => e.eventKey === f.eventKey,
          );
          await tx.aiRiskFinding.create({
            data: {
              runId: run.id,
              eventKey: f.eventKey,
              ruleId: f.ruleId,
              severity: f.severity,
              dimensions: f.dimensions,
              fact: f.fact,
              evidence: f.evidence as unknown as Prisma.InputJsonValue,
              ...(explanation
                ? { inference: explanation as unknown as Prisma.InputJsonValue }
                : {}),
            },
          });
        }
      });
    } catch (e) {
      const revoked =
        e instanceof ForbiddenException || e instanceof NotFoundException;
      await this.db.aiAnalysisRun
        .updateMany({
          where: lease,
          data: {
            status: revoked ? "CANCELLED" : "FAILED",
            errorCode: revoked
              ? "AUTH_REVOKED"
              : signal.aborted
                ? "WORKER_STOPPED"
                : "SOURCE_UNAVAILABLE",
            finishedAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
        .catch(() => undefined);
    }
  }
}
