import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { User } from "@spm/shared";
import { DbService } from "../db/db.module";
import { Database, ProjectsService } from "../projects/projects.module";
import { RequirementsService } from "../requirements/requirements.module";
import { StoriesService } from "../stories/stories.service";
import { TasksService } from "../tasks/tasks.module";
import { AiConfig } from "./ai.config";
import { fingerprint } from "./context.service";
import { AnalysisScope } from "./ai.types";
import { Prisma } from "../generated/prisma/client";
export const candidateKinds = [
  "GOAL",
  "EPIC",
  "REQUIREMENT",
  "STORY",
  "TASK",
] as const;
export interface Candidate {
  key: string;
  kind: (typeof candidateKinds)[number];
  title: string;
  description: string;
  acceptanceCriteria: string;
  action: "CREATE" | "REUSE" | "SKIP" | "UPDATE";
  reviewed: boolean;
  existingId?: number;
  parentKey?: string;
  goalKey?: string;
  epicKey?: string;
  requirementKeys: string[];
  storyKeys: string[];
  planIds: string[];
  assigneeUserId?: number | null;
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  suggestedReuseId?: number;
}
function text(v: unknown, max: number, required = false) {
  if (v === undefined && !required) return "";
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw new BadRequestException("候选字段无效或超长");
  return v.trim();
}
export function parseCandidates(
  value: unknown,
  generated = false,
): Candidate[] {
  if (!Array.isArray(value) || !value.length || value.length > 30)
    throw new BadRequestException("候选数量必须为1–30");
  const keys = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object")
      throw new BadRequestException("候选结构无效");
    const x = raw as Record<string, unknown>;
    const key = text(x.key, 64, true);
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || keys.has(key))
      throw new BadRequestException("候选标识重复或非法");
    keys.add(key);
    if (!candidateKinds.includes(x.kind as Candidate["kind"]))
      throw new BadRequestException("候选对象类型无效");
    const action = generated ? "CREATE" : x.action;
    if (!["CREATE", "REUSE", "SKIP", "UPDATE"].includes(action as string))
      throw new BadRequestException("请选择创建、复用、修改验收或跳过");
    const refs = (k: string) => {
      const v = x[k] ?? [];
      if (
        !Array.isArray(v) ||
        v.length > 100 ||
        v.some((s) => typeof s !== "string" || s.length > 100) ||
        new Set(v).size !== v.length
      )
        throw new BadRequestException("关联引用无效");
      return v as string[];
    };
    const number = (k: string) => {
      const v = x[k];
      if (v === undefined || v === null) return undefined;
      if (
        !Number.isSafeInteger(v) ||
        (v as number) < 1 ||
        (v as number) > 2147483647
      )
        throw new BadRequestException("对象编号无效");
      return v as number;
    };
    if (x.assigneeUserId !== undefined && x.assigneeUserId !== null)
      number("assigneeUserId");
    if (x.reviewed !== undefined && typeof x.reviewed !== "boolean")
      throw new BadRequestException("审核状态无效");
    if (
      x.priority !== undefined &&
      !["URGENT", "HIGH", "MEDIUM", "LOW"].includes(x.priority as string)
    )
      throw new BadRequestException("优先级无效");
    return {
      key,
      kind: x.kind as Candidate["kind"],
      title: text(x.title, 200, true),
      description: text(x.description, 10000),
      acceptanceCriteria: text(x.acceptanceCriteria, 10000),
      action: action as Candidate["action"],
      reviewed: generated ? false : x.reviewed === true,
      existingId: number("existingId"),
      ...Object.fromEntries(
        ["parentKey", "goalKey", "epicKey"]
          .filter((k) => x[k])
          .map((k) => [k, text(x[k], 100, true)]),
      ),
      requirementKeys: refs("requirementKeys"),
      storyKeys: refs("storyKeys"),
      planIds: refs("planIds"),
      assigneeUserId:
        x.assigneeUserId === null ? null : number("assigneeUserId"),
      priority: ["URGENT", "HIGH", "MEDIUM", "LOW"].includes(
        x.priority as string,
      )
        ? (x.priority as Candidate["priority"])
        : "MEDIUM",
    };
  });
}
@Injectable()
export class AiPlanningService {
  constructor(
    private db: DbService,
    private projects: ProjectsService,
    private requirements: RequirementsService,
    private stories: StoriesService,
    private tasks: TasksService,
    private config: AiConfig,
  ) {}
  async baseline(tx: Database, p: number) {
    const [requirements, goals, epics, stories, tasks, plans, members] =
      await Promise.all([
        tx.requirement.findMany({
          where: { projectId: p },
          select: { id: true, revision: true },
          orderBy: { id: "asc" },
        }),
        tx.productGoal.findMany({
          where: { projectId: p },
          select: { id: true, revision: true },
          orderBy: { id: "asc" },
        }),
        tx.epic.findMany({
          where: { projectId: p },
          select: { id: true, revision: true },
          orderBy: { id: "asc" },
        }),
        tx.userStory.findMany({
          where: { projectId: p },
          select: { id: true, revision: true },
          orderBy: { id: "asc" },
        }),
        tx.task.findMany({
          where: { projectId: p },
          select: { id: true, revision: true, archivedAt: true },
          orderBy: { id: "asc" },
        }),
        tx.planItem.findMany({
          where: { projectId: p },
          select: { id: true, revision: true },
          orderBy: { id: "asc" },
        }),
        tx.projectMember.findMany({
          where: { projectId: p },
          select: {
            userId: true,
            role: true,
            user: { select: { active: true } },
          },
          orderBy: { userId: "asc" },
        }),
      ]);
    return { requirements, goals, epics, stories, tasks, plans, members };
  }
  async generationContext(a: User, p: number, scope: AnalysisScope) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      if (
        scope.requirementId &&
        !(await tx.requirement.findFirst({
          where: { projectId: p, id: scope.requirementId },
        }))
      )
        throw new NotFoundException("源需求不存在");
      if (
        scope.taskId &&
        !(await tx.task.findFirst({
          where: { projectId: p, id: scope.taskId, archivedAt: null },
        }))
      )
        throw new NotFoundException("源任务不存在");
      const [requirements, goals, epics, stories, tasks] = await Promise.all([
        tx.requirement.findMany({
          where: { projectId: p },
          select: {
            id: true,
            title: true,
            description: true,
            acceptanceCriteria: true,
            parentId: true,
            revision: true,
          },
          orderBy: { id: "asc" },
          take: this.config.maxEntities + 1,
        }),
        tx.productGoal.findMany({
          where: { projectId: p },
          select: { id: true, title: true, revision: true },
          orderBy: { id: "asc" },
          take: this.config.maxEntities + 1,
        }),
        tx.epic.findMany({
          where: { projectId: p },
          select: { id: true, title: true, goalId: true, revision: true },
          orderBy: { id: "asc" },
          take: this.config.maxEntities + 1,
        }),
        tx.userStory.findMany({
          where: { projectId: p },
          select: {
            id: true,
            title: true,
            description: true,
            acceptanceCriteria: true,
            epicId: true,
            revision: true,
            requirementLinks: { select: { requirementId: true } },
          },
          orderBy: { id: "asc" },
          take: this.config.maxEntities + 1,
        }),
        tx.task.findMany({
          where: {
            projectId: p,
            archivedAt: null,
            ...(scope.taskId ? { id: scope.taskId } : {}),
          },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            progress: true,
            revision: true,
            storyLinks: { select: { storyId: true } },
            planLinks: { select: { planId: true } },
            history: {
              select: { action: true, createdAt: true },
              orderBy: { id: "desc" },
              take: 10,
            },
          },
          orderBy: { id: "asc" },
          take: this.config.maxEntities + 1,
        }),
      ]);
      if (
        requirements.length +
          goals.length +
          epics.length +
          stories.length +
          tasks.length >
        this.config.maxEntities
      )
        throw new BadRequestException("AI_CONTEXT_TOO_LARGE");
      const baseline = await this.baseline(tx, p);
      const input = {
        requirements,
        goals,
        epics,
        stories,
        tasks,
        sourceRequirementId: scope.requirementId,
        sourceTaskId: scope.taskId,
        request: scope.requestText || "",
        taskHistoryLimit: 10,
      };
      const asOf = new Intl.DateTimeFormat("sv-SE", {
        timeZone: this.config.timeZone,
      }).format(new Date());
      return {
        input,
        baseline,
        asOf,
        hash: fingerprint({ baseline, input, asOf }),
      };
    });
  }
  async list(a: User, p: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      return tx.aiDraft.findMany({
        where: { projectId: p, authorId: a.id },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          status: true,
          revision: true,
          updatedAt: true,
          kind: true,
        },
      });
    });
  }
  async read(a: User, p: number, id: string) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const d = await tx.aiDraft.findFirst({
        where: { id, projectId: p, authorId: a.id },
      });
      if (!d) throw new NotFoundException("草稿不存在");
      const current = await this.baseline(tx, p);
      return { ...d, stale: fingerprint(current) !== fingerprint(d.baseline) };
    });
  }
  async create(a: User, p: number, title: string, runId?: string) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      let items: Candidate[] = [],
        kind = "PLANNING",
        baseline = await this.baseline(tx, p);
      if (runId) {
        const run = await tx.aiAnalysisRun.findFirst({
          where: {
            id: runId,
            projectId: p,
            requestedById: a.id,
            status: "COMPLETED",
            kind: { in: ["PLANNING", "TASK_SPLIT"] },
          },
        });
        if (!run || !run.output)
          throw new BadRequestException("只能从本人已完成的规划结果创建草稿");
        const output = run.output as unknown as {
          items: Candidate[];
          baseline: typeof baseline;
        };
        items = parseCandidates(output.items, true);
        baseline = output.baseline;
        kind = run.kind;
      }
      const created = await tx.aiDraft.create({
        data: {
          projectId: p,
          authorId: a.id,
          title: text(title, 200, true),
          kind,
          sourceRunId: runId,
          items: items as unknown as Prisma.InputJsonValue,
          baseline,
        },
      });
      return {
        ...created,
        stale:
          fingerprint(baseline) !== fingerprint(await this.baseline(tx, p)),
      };
    });
  }
  async save(
    a: User,
    p: number,
    id: string,
    revision: number,
    title: string,
    raw: unknown,
  ) {
    const items = parseCandidates(raw);
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const d = await tx.aiDraft.findFirst({
        where: { id, projectId: p, authorId: a.id },
      });
      if (!d) throw new NotFoundException("草稿不存在");
      if (d.status !== "DRAFT" || d.revision !== revision)
        throw new ConflictException("草稿已变化或已提交");
      const saved = await tx.aiDraft.update({
        where: { id },
        data: {
          title: text(title, 200, true),
          items: items as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      return {
        ...saved,
        stale:
          fingerprint(d.baseline) !== fingerprint(await this.baseline(tx, p)),
      };
    });
  }
  async revalidate(a: User, p: number, id: string, revision: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const d = await tx.aiDraft.findFirst({
        where: { id, projectId: p, authorId: a.id },
      });
      if (!d) throw new NotFoundException();
      if (d.status !== "DRAFT" || d.revision !== revision)
        throw new ConflictException("草稿版本已变化");
      const items = parseCandidates(d.items).map((i) => ({
        ...i,
        reviewed: false,
      }));
      // Validate every existing reference again; never carry an obsolete approval forward.
      await this.validateReferences(tx, p, items);
      return tx.aiDraft.update({
        where: { id },
        data: {
          baseline: await this.baseline(tx, p),
          items: items as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
    });
  }
  private async validateReferences(
    tx: Database,
    p: number,
    items: Candidate[],
  ) {
    const model = {
      GOAL: tx.productGoal,
      EPIC: tx.epic,
      REQUIREMENT: tx.requirement,
      STORY: tx.userStory,
      TASK: tx.task,
    };
    const exists = async (kind: Candidate["kind"], id: number) => {
      const row = await (model[kind] as any).findFirst({
        where: {
          id,
          projectId: p,
          ...(kind === "TASK" ? { archivedAt: null } : {}),
        },
      });
      if (!row) throw new BadRequestException("引用对象不存在、已归档或跨项目");
    };
    for (const i of items) {
      if (i.action === "SKIP") continue;
      if (i.action !== "CREATE") {
        if (!i.existingId)
          throw new BadRequestException("复用或修改必须选择已有对象");
        await exists(i.kind, i.existingId);
      }
      for (const [kind, ref] of [
        ["REQUIREMENT", i.parentKey],
        ["GOAL", i.goalKey],
        ["EPIC", i.epicKey],
        ...i.requirementKeys.map((r) => ["REQUIREMENT", r]),
        ...i.storyKeys.map((r) => ["STORY", r]),
      ] as [Candidate["kind"], string | undefined][]) {
        if (!ref) continue;
        if (ref.includes(":")) {
          const [type, id] = ref.split(":");
          if (
            type !== kind.toLowerCase() ||
            !/^\d+$/.test(id) ||
            !Number.isSafeInteger(Number(id)) ||
            Number(id) < 1 ||
            Number(id) > 2147483647
          )
            throw new BadRequestException("引用类型无效");
          await exists(kind, Number(id));
        } else {
          const target = items.find((x) => x.key === ref);
          if (!target || target.kind !== kind || target.action === "SKIP")
            throw new BadRequestException("关联候选缺失、类型不符或已跳过");
        }
      }
      if (i.assigneeUserId)
        await this.tasks.validateAssignee(tx, p, i.assigneeUserId);
      if (
        i.planIds.length &&
        (await tx.planItem.count({
          where: { projectId: p, id: { in: i.planIds } },
        })) !== i.planIds.length
      )
        throw new BadRequestException("计划引用跨项目或不存在");
    }
  }
  async commit(a: User, p: number, id: string, revision: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const d = await tx.aiDraft.findFirst({
        where: { id, projectId: p, authorId: a.id },
      });
      if (!d) throw new NotFoundException("草稿不存在");
      if (d.status === "COMMITTED") return d;
      if (d.revision !== revision)
        throw new ConflictException("草稿版本已变化");
      if (fingerprint(d.baseline) !== fingerprint(await this.baseline(tx, p)))
        throw new ConflictException("业务数据已变化，请重新校验并逐项审核");
      const items = parseCandidates(d.items);
      if (items.some((i) => !i.reviewed))
        throw new BadRequestException("每一项（含跳过项）均需人工审核");
      await this.validateReferences(tx, p, items);
      if (d.kind === "TASK_SPLIT" && items.some((i) => i.kind !== "TASK"))
        throw new BadRequestException("任务拆分只创建独立任务");
      const resolved = new Map<string, number>(),
        visiting = new Set<string>();
      const ref = async (
        kind: Candidate["kind"],
        key?: string,
      ): Promise<number | undefined> => {
        if (!key) return undefined;
        if (key.includes(":")) return Number(key.split(":")[1]);
        const c = items.find((i) => i.key === key);
        if (!c || c.kind !== kind) throw new BadRequestException("引用无效");
        return perform(c);
      };
      const perform = async (i: Candidate): Promise<number> => {
        if (resolved.has(i.key)) return resolved.get(i.key)!;
        if (visiting.has(i.key))
          throw new BadRequestException("候选关系存在循环");
        if (i.action === "SKIP")
          throw new BadRequestException("引用了跳过的对象");
        visiting.add(i.key);
        let result: number;
        if (i.action === "UPDATE" && !["REQUIREMENT", "STORY"].includes(i.kind))
          throw new BadRequestException("仅支持人工补充需求/故事验收");
        if (i.action !== "CREATE") {
          result = i.existingId!;
          if (i.action === "UPDATE" && i.kind === "REQUIREMENT")
            await this.requirements.update(
              a,
              p,
              result,
              { acceptanceCriteria: i.acceptanceCriteria },
              tx,
            );
          if (i.kind === "STORY") {
            const ids = (await Promise.all(
              i.requirementKeys.map((r) => ref("REQUIREMENT", r)),
            )) as number[];
            const s = await tx.userStory.findUniqueOrThrow({
              where: { id: result },
              include: { requirementLinks: true },
            });
            if (ids.length || i.action === "UPDATE")
              await this.stories.editStory(
                a,
                p,
                result,
                {
                  revision: s.revision,
                  ...(i.action === "UPDATE"
                    ? { acceptanceCriteria: i.acceptanceCriteria }
                    : {}),
                  requirementIds: [
                    ...new Set([
                      ...s.requirementLinks.map((l) => l.requirementId),
                      ...ids,
                    ]),
                  ],
                },
                tx,
              );
          }
          if (i.kind === "TASK" && (i.storyKeys.length || i.planIds.length)) {
            const storyIds = (await Promise.all(
              i.storyKeys.map((r) => ref("STORY", r)),
            )) as number[];
            const task = await tx.task.findUniqueOrThrow({
              where: { id: result },
              include: { storyLinks: true, planLinks: true },
            });
            await this.tasks.change(
              a,
              p,
              result,
              "edit",
              {
                revision: task.revision,
                storyIds: [
                  ...new Set([
                    ...task.storyLinks.map((l) => l.storyId),
                    ...storyIds,
                  ]),
                ],
                planIds: [
                  ...new Set([
                    ...task.planLinks.map((l) => l.planId),
                    ...i.planIds,
                  ]),
                ],
              },
              tx,
            );
          }
        } else if (i.kind === "GOAL")
          result = (await this.stories.createGoal(a, p, { title: i.title }, tx))
            .id;
        else if (i.kind === "EPIC") {
          const goalId = await ref("GOAL", i.goalKey);
          if (!goalId) throw new BadRequestException("Epic必须选择产品目标");
          result = (
            await this.stories.createEpic(a, p, { title: i.title, goalId }, tx)
          ).id;
        } else if (i.kind === "REQUIREMENT") {
          const parentId = await ref("REQUIREMENT", i.parentKey);
          result = (
            await this.requirements.create(
              a,
              p,
              {
                title: i.title,
                description: i.description,
                acceptanceCriteria: i.acceptanceCriteria,
                parentId,
              },
              tx,
            )
          ).id;
        } else if (i.kind === "STORY") {
          const epicId = await ref("EPIC", i.epicKey);
          if (!epicId) throw new BadRequestException("故事必须选择Epic");
          const requirementIds = (await Promise.all(
            i.requirementKeys.map((r) => ref("REQUIREMENT", r)),
          )) as number[];
          if (!requirementIds.length)
            throw new BadRequestException("候选故事必须关联正式需求");
          result = (
            await this.stories.createStory(
              a,
              p,
              {
                title: i.title,
                description: i.description,
                acceptanceCriteria: i.acceptanceCriteria,
                epicId,
                requirementIds,
              },
              tx,
            )
          ).id;
        } else {
          const storyIds = (await Promise.all(
            i.storyKeys.map((r) => ref("STORY", r)),
          )) as number[];
          result = (
            await this.tasks.create(
              a,
              p,
              {
                title: i.title,
                description: i.description,
                priority: i.priority,
                assigneeUserId: i.assigneeUserId ?? null,
                storyIds,
                planIds: i.planIds,
              },
              tx,
            )
          ).id;
        }
        visiting.delete(i.key);
        resolved.set(i.key, result);
        return result;
      };
      for (const i of items) if (i.action !== "SKIP") await perform(i);
      return tx.aiDraft.update({
        where: { id },
        data: {
          status: "COMMITTED",
          revision: { increment: 1 },
          result: {
            objects: items
              .filter((i) => i.action !== "SKIP")
              .map((i) => ({
                key: i.key,
                kind: i.kind,
                id: resolved.get(i.key)!,
                action: i.action,
              })),
            actorId: a.id,
            committedAt: new Date().toISOString(),
          },
        },
      });
    });
  }
}
