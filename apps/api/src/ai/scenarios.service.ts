import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { User } from "@spm/shared";
import { Prisma } from "../generated/prisma/client";
import { DbService } from "../db/db.module";
import { ProjectsService } from "../projects/projects.module";
import { AiContextService } from "./context.service";
import { AnalysisScope, AnalysisContext } from "./ai.types";
import { detectRisks } from "./rules";
@Injectable()
export class AiScenariosService {
  constructor(
    private db: DbService,
    private projects: ProjectsService,
    private context: AiContextService,
  ) {}
  async simulate(a: User, p: number, id: string, shifts: number[]) {
    await this.projects.authorized(a, p, true);
    const run = await this.db.aiAnalysisRun.findFirst({
      where: {
        id,
        projectId: p,
        kind: "PLAN",
        status: { in: ["COMPLETED", "PARTIAL"] },
      },
    });
    if (!run) throw new NotFoundException("计划报告不存在或未完成");
    if (
      shifts.length !== 2 ||
      shifts.some((d) => !Number.isInteger(d) || d < -90 || d > 90)
    )
      throw new BadRequestException("请选择两个-90到90天的候选位移");
    const c = await this.context.build(
      a,
      p,
      "PLAN",
      run.scope as AnalysisScope,
    );
    if (c.hash !== run.sourceHash)
      throw new ConflictException("计划基线已过期，请手动重新分析");
    const baseline = detectRisks(c, "PLAN").findings;
    const add = (s: string, n: number) =>
      new Date(Date.parse(s + "T00:00:00Z") + n * 86400000)
        .toISOString()
        .slice(0, 10);
    const scenarios = shifts.map((shift, index) => {
      const changes = c.items
        .filter(
          (i) => i.status !== "DONE" && (index === 0 || i.kind !== "milestone"),
        )
        .map((i) => ({
          ...i,
          originalStart: i.start,
          originalEnd: i.end,
          start: add(i.start, shift),
          end: add(i.end, shift),
        }));
      const next = {
        ...c,
        items: c.items.map((i) => changes.find((x) => x.id === i.id) || i),
        evidence: new Map(c.evidence),
      } as AnalysisContext;
      changes.forEach((i) => {
        const old = next.evidence.get("planItem:" + i.id)!;
        next.evidence.set(old.key, {
          ...old,
          fields: { ...old.fields, start: i.start, end: i.end },
        });
      });
      const risks = detectRisks(next, "PLAN").findings;
      return {
        name: index === 0 ? "整体候选日期位移" : "保留里程碑、仅调整工作项",
        shiftDays: shift,
        changes,
        baselineRisks: baseline.length,
        candidateRisks: risks.length,
        conflicts: risks.filter((r) =>
          ["PLAN_OUTSIDE_STAGE", "SAME_OWNER_PLAN_OVERLAP"].includes(r.ruleId),
        ),
        uncertainty:
          "仅为日期区间规则推演，不代表依赖可行性、工时容量或延期概率；必须打开原编辑器人工保存。",
      };
    });
    await this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      await tx.aiAnalysisRun.update({
        where: { id },
        data: {
          output: {
            scenarios,
            baselineHash: c.hash,
            simulatedAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return { scenarios, baselineHash: c.hash };
  }
}
