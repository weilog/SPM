import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { User } from "@spm/shared";
import { DbService } from "../db/db.module";
import { ProjectsService } from "../projects/projects.module";
import { AiConfig } from "./ai.config";
import { AiContextService, fingerprint } from "./context.service";
import { AiPlanningService } from "./planning.service";
import {
  AnalysisKind,
  AnalysisScope,
  Evidence,
  RULES_VERSION,
} from "./ai.types";
@Injectable()
export class AiAnalysisService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
    private readonly config: AiConfig,
    private readonly context: AiContextService,
    private readonly planning: AiPlanningService,
  ) {}
  async create(
    actor: User,
    p: number,
    kind: AnalysisKind,
    scope: AnalysisScope,
    key?: string,
    retryOf?: string,
    retryDepth = 0,
  ) {
    await this.projects.authorized(actor, p, true);
    if (!this.config.enabled)
      throw new ServiceUnavailableException("AI_DISABLED");
    if (
      (scope.taskId && !["TASK", "TASK_SPLIT"].includes(kind)) ||
      (scope.requirementId && kind !== "PLANNING") ||
      (scope.requestText && !["PLANNING", "TASK_SPLIT"].includes(kind)) ||
      (kind === "TASK_SPLIT" && !scope.taskId) ||
      (kind === "PLANNING" && !scope.requestText?.trim()) ||
      (scope.stageId && !["PLAN", "MEMBER"].includes(kind)) ||
      (scope.stageId && scope.taskId)
    )
      throw new BadRequestException("分析范围不适用于该分析类型");
    if (["PLANNING", "TASK_SPLIT"].includes(kind))
      await this.planning.generationContext(actor, p, scope);
    else await this.context.build(actor, p, kind, scope);
    const requestKey = key || randomUUID(),
      requestHash = fingerprint({ kind, scope, retryOf: retryOf || null });
    const work = () =>
      this.db.atomic(async (tx) => {
        await this.projects.authorized(actor, p, true, tx);
        const existing = await tx.aiAnalysisRun.findFirst({
          where: { projectId: p, requestedById: actor.id, requestKey },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new ConflictException("幂等键已用于不同请求");
          return existing;
        }
        const now = Date.now();
        if (
          (await tx.aiAnalysisRun.count({
            where: {
              projectId: p,
              requestedById: actor.id,
              createdAt: { gte: new Date(now - 60000) },
            },
          })) >= this.config.maxRunsMinute ||
          (await tx.aiAnalysisRun.count({
            where: {
              projectId: p,
              createdAt: { gte: new Date(now - 86400000) },
            },
          })) >= this.config.maxRuns24h
        )
          throw new HttpException("AI_RATE_LIMITED", 429);
        return tx.aiAnalysisRun.create({
          data: {
            projectId: p,
            requestedById: actor.id,
            kind,
            scope: { ...scope },
            requestKey,
            requestHash,
            rulesVersion: RULES_VERSION,
            retryOf,
            retryDepth,
          },
        });
      });
    try {
      return await work();
    } catch (e) {
      await this.projects.authorized(actor, p, true);
      const existing = await this.db.aiAnalysisRun.findFirst({
        where: { projectId: p, requestedById: actor.id, requestKey },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException("幂等键已用于不同请求");
        return existing;
      }
      throw e;
    }
  }
  async retry(actor: User, p: number, id: string, key?: string) {
    await this.projects.authorized(actor, p, true);
    const run = await this.db.aiAnalysisRun.findFirst({
      where: { id, projectId: p },
    });
    if (!run) throw new NotFoundException("分析记录不存在");
    if (!["FAILED", "PARTIAL"].includes(run.status))
      throw new BadRequestException("仅失败或部分成功的分析可以重试");
    if (run.retryDepth >= this.config.maxRetries)
      throw new BadRequestException("AI_RETRY_LIMIT");
    return this.create(
      actor,
      p,
      run.kind as AnalysisKind,
      run.scope as AnalysisScope,
      key,
      id,
      run.retryDepth + 1,
    );
  }
  async cancel(actor: User, p: number, id: string) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(actor, p, true, tx);
      const run = await tx.aiAnalysisRun.findFirst({
        where: { id, projectId: p },
      });
      if (!run) throw new NotFoundException("分析记录不存在");
      await tx.aiAnalysisRun.updateMany({
        where: { id, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "CANCELLED",
          errorCode: "USER_CANCELLED",
          finishedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      return {
        id,
        status: (await tx.aiAnalysisRun.findUniqueOrThrow({ where: { id } }))
          .status,
      };
    });
  }
  async report(actor: User, p: number, id: string) {
    const project = await this.projects.authorized(actor, p);
    const run = await this.db.aiAnalysisRun.findFirst({
      where: { id, projectId: p },
      include: { findings: { orderBy: { eventKey: "asc" } } },
    });
    if (!run) throw new NotFoundException("分析记录不存在");
    const generation = ["PLANNING", "TASK_SPLIT"].includes(run.kind);
    if (generation && !project.canManage)
      throw new NotFoundException("分析记录不存在");

    const ctx = await this.context.build(
      actor,
      p,
      run.kind as AnalysisKind,
      run.scope as AnalysisScope,
    );
    const findings = run.findings
      .filter(
        (f) =>
          project.canManage ||
          (f.evidence as unknown as Evidence[]).every((e) =>
            ctx.visibleKeys.has(e.key),
          ),
      )
      .map((f) => ({
        id: f.id,
        eventKey: f.eventKey,
        ruleId: f.ruleId,
        severity: f.severity,
        dimensions: f.dimensions,
        fact: f.fact,
        evidence: f.evidence,
        ...(project.canManage ? { inference: f.inference } : {}),
        evidenceCurrent: (f.evidence as unknown as Evidence[]).every(
          (e) => fingerprint(e) === fingerprint(ctx.evidence.get(e.key)),
        ),
      }));
    const dimensions: Record<string, number> = {};
    for (const f of findings)
      for (const d of f.dimensions as string[])
        dimensions[d] = (dimensions[d] || 0) + 1;
    const stale =
      run.sourceHash !== null &&
      (run.sourceDate !== ctx.asOf ||
        run.rulesVersion !== RULES_VERSION ||
        (project.canManage
          ? run.sourceHash !==
            (generation
              ? (
                  await this.planning.generationContext(
                    actor,
                    p,
                    run.scope as AnalysisScope,
                  )
                ).hash
              : ctx.hash)
          : findings.some((f) => !f.evidenceCurrent)));
    // Authorization is checked again after loading evidence, so revocation cannot publish a response.
    await this.projects.authorized(actor, p, project.canManage);
    if (!project.canManage) {
      const fresh = await this.context.build(
        actor,
        p,
        run.kind as AnalysisKind,
        run.scope as AnalysisScope,
      );
      if (
        findings.some((f) =>
          (f.evidence as unknown as Evidence[]).some(
            (e) => !fresh.visibleKeys.has(e.key),
          ),
        )
      )
        throw new ConflictException("授权数据已变化，请重新读取报告");
    }
    return {
      id: run.id,
      kind: run.kind,
      status: run.status,
      scope: run.scope,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      sourceDate: run.sourceDate,
      rulesVersion: run.rulesVersion,
      stale,
      summary: { uniqueEvents: findings.length, dimensions },
      findings,
      visibility: project.canManage
        ? "PROJECT_MANAGER"
        : "AUTHORIZED_FACTS_ONLY",
      ...(project.canManage
        ? {
            modelState: run.modelState,
            modelInfo: run.modelInfo,
            errorCode: run.errorCode,
            sourceHash: run.sourceHash,
            retryDepth: run.retryDepth,
            output: run.output,
          }
        : {}),
    };
  }
  async history(actor: User, p: number, limit: number, cursor?: string) {
    await this.projects.authorized(actor, p);
    if (
      cursor &&
      !(await this.db.aiAnalysisRun.findFirst({
        where: { id: cursor, projectId: p },
      }))
    )
      throw new NotFoundException("历史游标不存在");
    const rows = await this.db.aiAnalysisRun.findMany({
      where: { projectId: p },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = [];
    for (const row of rows.slice(0, limit)) {
      try {
        const r = await this.report(actor, p, row.id);
        const { findings, ...metadata } = r;
        items.push(metadata);
      } catch (e) {
        if (!(e instanceof NotFoundException)) throw e;
      }
    }
    await this.projects.authorized(actor, p);
    return {
      items,
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
}
