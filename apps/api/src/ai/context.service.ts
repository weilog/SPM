import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { User } from "@spm/shared";
import { DbService } from "../db/db.module";
import { ProjectsService } from "../projects/projects.module";
import { AiConfig } from "./ai.config";
import {
  AnalysisContext,
  AnalysisKind,
  AnalysisScope,
  Evidence,
  Fields,
} from "./ai.types";
export function fingerprint(value: unknown): string {
  // JSONB changes key order. Compare canonical content, not insertion order.
  // Missing/deleted source evidence must mark stale rather than fail loading.
  const serialized = JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
  return createHash("sha256")
    .update(serialized ?? "undefined")
    .digest("hex");
}
@Injectable()
export class AiContextService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
    private readonly config: AiConfig,
  ) {}
  async build(
    actor: User,
    projectId: number,
    kind: AnalysisKind,
    scope: AnalysisScope,
  ): Promise<AnalysisContext> {
    return this.db.atomic(async (tx) => {
      const project = await this.projects.authorized(
        actor,
        projectId,
        false,
        tx,
      );
      if (
        scope.stageId &&
        !(await tx.planStage.findFirst({
          where: { projectId, id: scope.stageId },
        }))
      )
        throw new NotFoundException("分析阶段不存在");
      if (
        scope.taskId &&
        !(await tx.task.findFirst({
          where: {
            projectId,
            id: scope.taskId,
            archivedAt: null,
            ...(!project.canManage ? { assigneeUserId: actor.id } : {}),
          },
        }))
      )
        throw new NotFoundException("分析任务不存在或无权访问");
      const take = this.config.maxEntities + 1;
      const needTasks = kind !== "COVERAGE" && kind !== "PLAN";
      const needPlans = kind !== "COVERAGE";
      const needCoverage = kind === "COVERAGE" || kind === "CROSS_VIEW";
      const members = await tx.projectMember.findMany({
        where: {
          projectId,
          ...(!project.canManage ? { userId: actor.id } : {}),
        },
        select: {
          userId: true,
          role: true,
          user: { select: { active: true } },
        },
        orderBy: { userId: "asc" },
        take,
      });
      const tasks = needTasks
        ? await tx.task.findMany({
            where: {
              projectId,
              archivedAt: null,
              ...(!project.canManage ? { assigneeUserId: actor.id } : {}),
              ...(scope.taskId ? { id: scope.taskId } : {}),
              ...(scope.stageId
                ? { planLinks: { some: { plan: { stageId: scope.stageId } } } }
                : {}),
            },
            select: {
              id: true,
              title: true,
              status: true,
              progress: true,
              priority: true,
              assigneeUserId: true,
              revision: true,
              planLinks: {
                select: { planId: true },
                orderBy: { planId: "asc" },
              },
            },
            orderBy: { id: "asc" },
            take,
          })
        : [];
      const items = needPlans
        ? await tx.planItem.findMany({
            where: {
              projectId,
              ...(scope.stageId ? { stageId: scope.stageId } : {}),
              ...(scope.taskId
                ? { taskLinks: { some: { taskId: scope.taskId } } }
                : {}),
            },
            select: {
              id: true,
              title: true,
              stageId: true,
              kind: true,
              start: true,
              end: true,
              status: true,
              ownerUserId: true,
              revision: true,
            },
            orderBy: { id: "asc" },
            take,
          })
        : [];
      const stages = needPlans
        ? await tx.planStage.findMany({
            where: {
              projectId,
              ...(scope.stageId ? { id: scope.stageId } : {}),
              ...(scope.taskId
                ? { id: { in: items.map((i) => i.stageId) } }
                : {}),
            },
            select: {
              id: true,
              title: true,
              start: true,
              end: true,
              revision: true,
            },
            orderBy: { id: "asc" },
            take,
          })
        : [];
      const requirements = needCoverage
        ? await tx.requirement.findMany({
            where: { projectId },
            select: {
              id: true,
              title: true,
              parentId: true,
              updatedAt: true,
              storyLinks: {
                select: { storyId: true },
                orderBy: { storyId: "asc" },
              },
            },
            orderBy: { id: "asc" },
            take,
          })
        : [];
      const stories = needCoverage
        ? await tx.userStory.findMany({
            where: { projectId },
            select: {
              id: true,
              title: true,
              revision: true,
              acceptanceCriteria: true,
              requirementLinks: {
                select: { requirementId: true },
                orderBy: { requirementId: "asc" },
              },
              useCaseLinks: {
                select: { nodeId: true },
                orderBy: { nodeId: "asc" },
              },
            },
            orderBy: { id: "asc" },
            take,
          })
        : [];
      if (
        members.length +
          tasks.length +
          items.length +
          stages.length +
          requirements.length +
          stories.length >
        this.config.maxEntities
      )
        throw new BadRequestException("AI_CONTEXT_TOO_LARGE");
      const asOf = new Intl.DateTimeFormat("sv-SE", {
        timeZone: this.config.timeZone,
      }).format(new Date());
      const evidence = new Map<string, Evidence>();
      const add = (
        entityType: string,
        entityId: number | string,
        fields: Fields,
      ) => {
        const key = `${entityType}:${entityId}`;
        evidence.set(key, { key, entityType, entityId, fields });
      };
      tasks.forEach((t) =>
        add("task", t.id, {
          title: t.title,
          status: t.status,
          progress: t.progress,
          priority: t.priority,
          assigneeUserId: t.assigneeUserId,
          planIds: t.planLinks.map((l) => l.planId),
        }),
      );
      items.forEach((i) =>
        add("planItem", i.id, {
          title: i.title,
          stageId: i.stageId,
          kind: i.kind,
          start: i.start,
          end: i.end,
          status: i.status,
          ownerUserId: i.ownerUserId,
        }),
      );
      stages.forEach((s) =>
        add("stage", s.id, { title: s.title, start: s.start, end: s.end }),
      );
      requirements.forEach((r) =>
        add("requirement", r.id, {
          title: r.title,
          parentId: r.parentId,
          storyIds: r.storyLinks.map((l) => l.storyId),
        }),
      );
      stories.forEach((s) =>
        add("story", s.id, {
          title: s.title,
          requirementIds: s.requirementLinks.map((l) => l.requirementId),
          umlUseCaseIds: s.useCaseLinks.map((l) => l.nodeId),
        }),
      );
      return {
        hash: fingerprint({
          asOf,
          kind,
          scope,
          project: {
            id: project.id,
            name: project.name,
            description: project.description,
          },
          members,
          tasks,
          items,
          stages,
          requirements,
          stories,
        }),
        asOf,
        visibleKeys: new Set(evidence.keys()),
        evidence,
        tasks,
        items,
        stages,
        requirements,
        stories,
      };
    });
  }
}
