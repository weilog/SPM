import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateIf,
  ArrayMaxSize,
  ArrayUnique,
} from "class-validator";
import type { PlanSnapshot, User } from "@spm/shared";
import { Actor } from "../common/security";
import { DbService } from "../db/db.module";
import {
  ProjectsModule,
  ProjectsService,
  Database,
} from "../projects/projects.module";

class PlanFields {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 200)
  title?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(0, 10000)
  description?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  end?: string;
  @IsOptional() @IsInt() @Min(1) ownerUserId?: number | null;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) revision?: number;
}
class ItemFields extends PlanFields {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 100)
  stageId?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(["item", "milestone"]) kind?:
    | "item"
    | "milestone";
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["TODO", "IN_PROGRESS", "DONE", "PAUSED"])
  status?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["NORMAL", "HIGH", "MEDIUM", "LOW"])
  priority?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  taskIds?: number[];
}
class GoalFields {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 200)
  title?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() done?: boolean;
}
const transitions: Record<string, string[]> = {
  TODO: ["IN_PROGRESS", "PAUSED"],
  IN_PROGRESS: ["DONE", "PAUSED"],
  DONE: ["IN_PROGRESS"],
  PAUSED: ["TODO"],
};
@Injectable()
export class PlanAdapter {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
  ) {}
  async snapshot(actor: User, projectId: number): Promise<PlanSnapshot> {
    return this.db.atomic(async (tx) => {
      const project = await this.projects.authorized(
        actor,
        projectId,
        false,
        tx,
      );
      const [members, stages, items] = await Promise.all([
        tx.projectMember.findMany({
          where: { projectId },
          include: {
            user: { select: { id: true, username: true, active: true } },
          },
        }),
        tx.planStage.findMany({
          where: { projectId },
          include: {
            goals: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
          },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        }),
        tx.planItem.findMany({
          where: { projectId },
          include: {
            taskLinks: {
              include: {
                task: { include: { storyLinks: true, planLinks: true } },
              },
            },
          },
          orderBy: { number: "asc" },
        }),
      ]);
      const owner = (id: number | null) =>
        members.find((m) => m.userId === id)?.user.username || "未指派";
      return {
        available: true,
        stages: stages.map((s) => ({ ...s, owner: owner(s.ownerUserId) })),
        items: items.map((i) => {
          const links = i.taskLinks.filter(
            (l) =>
              project.canManage ||
              (l.task.assigneeUserId === actor.id &&
                l.task.archivedAt === null),
          );
          const { taskLinks: _links, ...safe } = i;
          return {
            ...safe,
            kind: i.kind as "item" | "milestone",
            status: i.status as "TODO",
            priority: i.priority as "NORMAL",
            owner: owner(i.ownerUserId),
            taskIds: links.map((l) => l.taskId),
            tasks: links.map(({ task }) => {
              const { storyLinks, planLinks, ...t } = task;
              return {
                ...t,
                createdAt: t.createdAt.toISOString(),
                updatedAt: t.updatedAt.toISOString(),
                archivedAt: t.archivedAt?.toISOString() || null,
                storyIds: storyLinks.map((l) => l.storyId),
                planIds: planLinks.map((l) => l.planId),
                status: t.status as "TODO",
                priority: t.priority as "MEDIUM",
              };
            }),
          };
        }),
      };
    });
  }
  async validateIds(actor: User, projectId: number, ids: string[]) {
    if (!ids.length) return;
    await this.projects.authorized(actor, projectId, true);
    if (
      (await this.db.planItem.count({
        where: { projectId, id: { in: ids }, kind: "item" },
      })) !== new Set(ids).size
    )
      throw new BadRequestException("关联计划项无效或不属于当前项目");
  }
  private async owner(tx: Database, p: number, id: number | null | undefined) {
    if (
      id != null &&
      !(await tx.projectMember.findFirst({
        where: { projectId: p, userId: id, user: { active: true } },
      }))
    )
      throw new BadRequestException("负责人必须是当前项目的有效成员");
  }
  private fields(
    dto: PlanFields,
    current?: {
      title: string;
      description: string;
      start: string;
      end: string;
      ownerUserId: number | null;
    },
  ) {
    const value = {
      title: dto.title?.trim() ?? current?.title ?? "",
      description: dto.description ?? current?.description ?? "",
      start: dto.start ?? current?.start ?? "",
      end: dto.end ?? current?.end ?? "",
      ownerUserId:
        dto.ownerUserId === undefined
          ? (current?.ownerUserId ?? null)
          : dto.ownerUserId,
    };
    if (!value.title || !value.start || !value.end || value.end < value.start)
      throw new BadRequestException(
        "请填写名称和有效日期，结束日期不能早于开始日期",
      );
    return value;
  }
  private version(actual: number, expected?: number) {
    if (expected !== undefined && actual !== expected)
      throw new ConflictException("计划已更新，请刷新后重试");
  }
  async stage(actor: User, p: number, dto: PlanFields, id?: string) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(actor, p, true, tx);
      const current = id
        ? await tx.planStage.findFirst({ where: { projectId: p, id } })
        : null;
      if (id && !current) throw new NotFoundException("阶段不存在");
      if (current) this.version(current.revision, dto.revision);
      const data = this.fields(dto, current ?? undefined);
      await this.owner(tx, p, data.ownerUserId);
      if (current)
        return tx.planStage.update({
          where: { id: current.id },
          data: { ...data, revision: { increment: 1 } },
        });
      return tx.planStage.create({
        data: {
          ...data,
          projectId: p,
          sortOrder: await tx.planStage.count({ where: { projectId: p } }),
        },
      });
    });
  }
  async item(actor: User, p: number, dto: ItemFields, id?: string) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(actor, p, true, tx);
      const current = id
        ? await tx.planItem.findFirst({ where: { projectId: p, id } })
        : null;
      if (id && !current) throw new NotFoundException("计划项不存在");
      if (current) this.version(current.revision, dto.revision);
      const stageId = dto.stageId ?? current?.stageId;
      if (
        !stageId ||
        !(await tx.planStage.findFirst({
          where: { id: stageId, projectId: p },
        }))
      )
        throw new BadRequestException("阶段不属于当前项目");
      const kind = dto.kind ?? current?.kind ?? "item";
      if (current && kind !== current.kind)
        throw new BadRequestException("不能改变工作项类型");
      const data = this.fields(
        {
          ...dto,
          ...(kind === "milestone" ? { end: dto.start ?? current?.start } : {}),
        },
        current ?? undefined,
      );
      await this.owner(tx, p, data.ownerUserId);
      const status = dto.status ?? current?.status ?? "TODO";
      if (
        current &&
        status !== current.status &&
        !transitions[current.status].includes(status)
      )
        throw new BadRequestException("不允许该计划项状态流转");
      if (dto.taskIds?.length && kind === "milestone")
        throw new BadRequestException("里程碑不能关联任务");
      if (
        dto.taskIds &&
        (await tx.task.count({
          where: { projectId: p, id: { in: dto.taskIds } },
        })) !== dto.taskIds.length
      )
        throw new BadRequestException("关联任务不属于当前项目");
      const values = {
        ...data,
        stageId,
        kind,
        status,
        priority: dto.priority ?? current?.priority ?? "NORMAL",
      };
      const item = current
        ? await tx.planItem.update({
            where: { id: current.id },
            data: { ...values, revision: { increment: 1 } },
          })
        : await tx.planItem.create({ data: { ...values, projectId: p } });
      if (dto.taskIds) {
        const old = await tx.taskPlanReference.findMany({
          where: { projectId: p, planId: item.id },
        });
        const priorIds = new Set(old.map((l) => l.taskId));
        const changed = [...new Set([...priorIds, ...dto.taskIds])].filter(
          (id) => priorIds.has(id) !== dto.taskIds!.includes(id),
        );
        const priorLinks = await tx.taskPlanReference.findMany({
          where: { projectId: p, taskId: { in: changed } },
        });
        await tx.taskPlanReference.deleteMany({
          where: { projectId: p, planId: item.id },
        });
        if (dto.taskIds.length)
          await tx.taskPlanReference.createMany({
            data: dto.taskIds.map((taskId) => ({
              projectId: p,
              planId: item.id,
              taskId,
            })),
          });
        await tx.task.updateMany({
          where: {
            projectId: p,
            id: {
              in: changed,
            },
          },
          data: { revision: { increment: 1 } },
        });
        if (changed.length)
          await tx.taskHistory.createMany({
            data: changed.map((taskId) => {
              const before = priorLinks
                .filter((l) => l.taskId === taskId)
                .map((l) => l.planId);
              const after = before.filter((id) => id !== item.id);
              if (dto.taskIds!.includes(taskId)) after.push(item.id);
              return {
                taskId,
                actorUserId: actor.id,
                actorName: actor.username,
                action: dto.taskIds!.includes(taskId)
                  ? "关联计划项"
                  : "解除关联计划项",
                before: { planIds: before },
                after: { planIds: after },
              };
            }),
          });
      }
      return item;
    });
  }
  async goal(
    actor: User,
    p: number,
    stageId: string,
    dto: GoalFields,
    id?: string,
  ) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(actor, p, true, tx);
      if (
        !(await tx.planStage.findFirst({
          where: { id: stageId, projectId: p },
        }))
      )
        throw new NotFoundException("阶段不存在");
      if (
        id &&
        !(await tx.planGoal.findFirst({ where: { id, stageId, projectId: p } }))
      )
        throw new NotFoundException("目标不存在");
      if (!id && !dto.title?.trim())
        throw new BadRequestException("请输入目标");
      const data = {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.done !== undefined ? { done: dto.done } : {}),
      };
      const goal = id
        ? await tx.planGoal.update({ where: { id }, data })
        : await tx.planGoal.create({
            data: {
              projectId: p,
              stageId,
              title: dto.title!.trim(),
              sortOrder: await tx.planGoal.count({
                where: { projectId: p, stageId },
              }),
            },
          });
      await tx.planStage.update({
        where: { id: stageId },
        data: { revision: { increment: 1 } },
      });
      return goal;
    });
  }
}
@Controller("projects/:projectId/plan-adapter")
class PlanController {
  constructor(private readonly adapter: PlanAdapter) {}
  @Get() snapshot(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    return this.adapter.snapshot(a, p);
  }
  @Post("stages") createStage(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: PlanFields,
  ) {
    return this.adapter.stage(a, p, d);
  }
  @Patch("stages/:id") editStage(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id") id: string,
    @Body() d: PlanFields,
  ) {
    return this.adapter.stage(a, p, d, id);
  }
  @Post("items") createItem(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: ItemFields,
  ) {
    return this.adapter.item(a, p, d);
  }
  @Patch("items/:id") editItem(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id") id: string,
    @Body() d: ItemFields,
  ) {
    return this.adapter.item(a, p, d, id);
  }
  @Post("stages/:stageId/goals") createGoal(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("stageId") s: string,
    @Body() d: GoalFields,
  ) {
    return this.adapter.goal(a, p, s, d);
  }
  @Patch("stages/:stageId/goals/:id") editGoal(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("stageId") s: string,
    @Param("id") id: string,
    @Body() d: GoalFields,
  ) {
    return this.adapter.goal(a, p, s, d, id);
  }
}
@Module({
  imports: [ProjectsModule],
  providers: [PlanAdapter],
  exports: [PlanAdapter],
  controllers: [PlanController],
})
export class PlanAdapterModule {}
