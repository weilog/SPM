import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Transform } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { ArrayUnique, ArrayMaxSize, IsArray, IsIn } from "class-validator";
import { PlanAdapter, PlanAdapterModule } from "../plans/plan-adapter.module";
import {
  EditTaskDto,
  TaskProgressDto,
  TaskRevisionDto,
  TaskStatusDto,
} from "./task.dto";
import { Prisma } from "../generated/prisma/client";
import type { Priority, User } from "@spm/shared";
import { DbService } from "../db/db.module";
import { Actor } from "../common/security";
import {
  Database,
  ProjectsModule,
  ProjectsService,
} from "../projects/projects.module";

class CreateTaskDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["URGENT", "HIGH", "MEDIUM", "LOW"])
  priority?: Priority;
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  storyIds?: number[];
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  planIds?: string[];
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  title!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;
  @IsOptional() @IsInt() @Min(1) assigneeUserId?: number | null;
}
class AssignTaskDto {
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  assigneeUserId!: number | null;
}
const taskInclude = {
  storyLinks: { select: { storyId: true } },
  planLinks: { select: { planId: true } },
} as const;
function present<
  T extends {
    storyLinks: { storyId: number }[];
    planLinks: { planId: string }[];
  },
>(item: T) {
  const { storyLinks, planLinks, ...task } = item;
  return {
    ...task,
    storyIds: storyLinks.map((x) => x.storyId),
    planIds: planLinks.map((x) => x.planId),
  };
}
@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
    private readonly plans: PlanAdapter,
  ) {}
  async validateAssignee(
    tx: Database,
    projectId: number,
    userId: number | null | undefined,
  ) {
    if (userId == null) return;
    if (
      !(await tx.projectMember.findFirst({
        where: { projectId, userId, user: { active: true } },
      }))
    )
      throw new BadRequestException("负责人必须是当前项目的有效成员");
  }
  async list(actor: User, projectId: number, archived = false) {
    await this.projects.authorized(actor, projectId, true);
    // Project task management stays manager-only; graph/personal reads are scoped separately.
    return (
      await this.db.task.findMany({
        where: { projectId, archivedAt: archived ? { not: null } : null },
        orderBy: { id: "desc" },
        include: taskInclude,
      })
    ).map(present);
  }
  async mine(actor: User, projectId: number, taskId?: number) {
    const project = await this.projects.authorized(actor, projectId);
    if (!project.canViewOwnTasks)
      throw new ForbiddenException("当前项目角色不具备个人任务查看权限");
    // Assignee comes exclusively from the authenticated session, never from a query/body.
    const where = {
      projectId,
      archivedAt: null,
      assigneeUserId: actor.id,
      ...(taskId === undefined ? {} : { id: taskId }),
    };
    if (taskId === undefined)
      return (
        await this.db.task.findMany({
          where,
          orderBy: { id: "desc" },
          include: taskInclude,
        })
      ).map(present);
    const task = await this.db.task.findFirst({ where, include: taskInclude });
    if (!task) throw new NotFoundException("任务不存在或不属于本人");
    return present(task);
  }
  async create(actor: User, projectId: number, dto: CreateTaskDto) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(actor, projectId, true, tx);
      await this.validateAssignee(tx, projectId, dto.assigneeUserId);
      await this.validateRelations(
        tx,
        actor,
        projectId,
        dto.storyIds,
        dto.planIds,
      );
      const created = await tx.task.create({
        data: {
          projectId,
          title: dto.title,
          description: dto.description,
          assigneeUserId: dto.assigneeUserId,
          priority: dto.priority,
        },
      });
      await this.relations(
        tx,
        projectId,
        created.id,
        dto.storyIds,
        dto.planIds,
      );
      const task = present(
        await tx.task.findUniqueOrThrow({
          where: { id: created.id },
          include: taskInclude,
        }),
      );
      await this.history(tx, actor, created.id, "创建任务", {}, task);
      return task;
    });
  }
  async assign(
    actor: User,
    projectId: number,
    taskId: number,
    userId: number | null,
  ) {
    return this.change(actor, projectId, taskId, "assign", {
      assigneeUserId: userId,
    });
  }
  private async validateRelations(
    tx: Database,
    actor: User,
    projectId: number,
    storyIds?: number[],
    planIds?: string[],
  ) {
    if (
      storyIds &&
      (await tx.userStory.count({
        where: { projectId, id: { in: storyIds } },
      })) !== storyIds.length
    )
      throw new BadRequestException("关联故事必须属于当前项目");
    await this.plans.validateIds(actor, projectId, planIds ?? []);
  }
  private async relations(
    tx: Database,
    projectId: number,
    taskId: number,
    storyIds?: number[],
    planIds?: string[],
  ) {
    if (storyIds !== undefined) {
      await tx.storyTask.deleteMany({ where: { projectId, taskId } });
      await tx.storyTask.createMany({
        data: storyIds.map((storyId) => ({ projectId, taskId, storyId })),
      });
    }
    if (planIds !== undefined) {
      await tx.taskPlanReference.deleteMany({ where: { projectId, taskId } });
      await tx.taskPlanReference.createMany({
        data: planIds.map((planId) => ({ projectId, taskId, planId })),
      });
    }
  }
  private history(
    tx: Database,
    actor: User,
    taskId: number,
    action: string,
    before: unknown,
    after: unknown,
  ) {
    return tx.taskHistory.create({
      data: {
        taskId,
        actorUserId: actor.id,
        actorName: actor.username,
        action,
        before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
        after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
      },
    });
  }
  private async access(
    tx: Database,
    actor: User,
    projectId: number,
    taskId: number,
    manager = false,
  ) {
    const project = await this.projects.authorized(
      actor,
      projectId,
      manager,
      tx,
    );
    const task = await tx.task.findFirst({
      where: { projectId, id: taskId },
      include: taskInclude,
    });
    if (!task || (!project.canManage && task.assigneeUserId !== actor.id))
      throw new NotFoundException("任务不存在或不属于本人");
    return { project, task };
  }
  async detail(actor: User, projectId: number, id: number) {
    return this.db.atomic(async (tx) =>
      present((await this.access(tx, actor, projectId, id)).task),
    );
  }
  async activity(actor: User, projectId: number, id: number) {
    return this.db.atomic(async (tx) => {
      await this.access(tx, actor, projectId, id);
      return tx.taskHistory.findMany({
        where: { taskId: id },
        orderBy: { id: "desc" },
      });
    });
  }
  async graph(actor: User, projectId: number) {
    return this.db.atomic(async (tx) => {
      const project = await this.projects.authorized(
        actor,
        projectId,
        false,
        tx,
      );
      const tasks = await tx.task.findMany({
        where: {
          projectId,
          archivedAt: null,
          ...(!project.canManage ? { assigneeUserId: actor.id } : {}),
        },
        include: taskInclude,
        orderBy: { id: "asc" },
      });
      const members = await tx.projectMember.findMany({
        where: {
          projectId,
          ...(!project.canManage ? { userId: actor.id } : {}),
        },
        include: {
          user: {
            select: { id: true, username: true, active: true, role: true },
          },
        },
      });
      return { tasks: tasks.map(present), members, project };
    });
  }
  async change(
    actor: User,
    projectId: number,
    id: number,
    operation:
      | "edit"
      | "assign"
      | "status"
      | "progress"
      | "archive"
      | "restore",
    dto: EditTaskDto & Partial<TaskStatusDto & TaskProgressDto> = {},
  ) {
    return this.db.atomic(async (tx) => {
      const { project, task } = await this.access(
        tx,
        actor,
        projectId,
        id,
        ["edit", "assign", "archive", "restore"].includes(operation),
      );
      if (dto.revision !== undefined && dto.revision !== task.revision)
        throw new ConflictException("任务已更新，请刷新后重试");
      if (task.archivedAt && operation !== "restore")
        throw new BadRequestException("归档任务请先恢复");
      const data: Prisma.TaskUncheckedUpdateInput = {
        revision: { increment: 1 },
      };
      let action = "";
      if (operation === "edit" || operation === "assign") {
        const {
          title,
          description,
          priority,
          assigneeUserId,
          storyIds,
          planIds,
        } = dto;
        if (
          operation === "edit" &&
          [
            title,
            description,
            priority,
            assigneeUserId,
            storyIds,
            planIds,
          ].every((v) => v === undefined)
        )
          throw new BadRequestException("请提供修改内容");
        await this.validateAssignee(tx, projectId, assigneeUserId);
        await this.validateRelations(tx, actor, projectId, storyIds, planIds);
        Object.assign(data, { title, description, priority, assigneeUserId });
        await this.relations(tx, projectId, id, storyIds, planIds);
        action = operation === "assign" ? "调整负责人" : "编辑任务与关联";
      } else if (operation === "status") {
        if (task.status === "DONE" && !project.canManage)
          throw new ForbiddenException("已完成任务只能由项目经理重新打开");
        data.status = dto.status;
        data.progress =
          dto.status === "DONE"
            ? 100
            : dto.status === "TODO" || task.status === "DONE"
              ? 0
              : task.progress;
        action = "修改状态";
      } else if (operation === "progress") {
        if (task.status !== "IN_PROGRESS")
          throw new BadRequestException("仅进行中的任务可报告0–99%的完成进度");
        data.progress = dto.progress;
        action = "更新完成进度";
      } else {
        data.archivedAt = operation === "archive" ? new Date() : null;
        action = operation === "archive" ? "归档任务" : "恢复任务";
      }
      const updated = present(
        await tx.task.update({ where: { id }, data, include: taskInclude }),
      );
      await this.history(tx, actor, id, action, present(task), updated);
      return updated;
    });
  }
}
@Controller("projects/:projectId/tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Get() list(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Query("archived") archived?: string,
  ) {
    return this.tasks.list(actor, projectId, archived === "true");
  }
  @Get("mine") mine(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
  ) {
    return this.tasks.mine(actor, projectId);
  }
  @Get("mine/:taskId") mineDetail(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Param("taskId", ParseIntPipe) taskId: number,
  ) {
    return this.tasks.mine(actor, projectId, taskId);
  }
  @Get("graph") graph(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    return this.tasks.graph(a, p);
  }
  @Get(":id/history") history(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.tasks.activity(a, p, id);
  }
  @Get(":id") detail(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.tasks.detail(a, p, id);
  }
  @Patch(":id") edit(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: EditTaskDto,
  ) {
    return this.tasks.change(a, p, id, "edit", d);
  }
  @Patch(":id/status") status(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: TaskStatusDto,
  ) {
    return this.tasks.change(a, p, id, "status", d);
  }
  @Patch(":id/progress") progress(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: TaskProgressDto,
  ) {
    return this.tasks.change(a, p, id, "progress", d);
  }
  @Post(":id/archive") archive(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: TaskRevisionDto,
  ) {
    return this.tasks.change(a, p, id, "archive", d);
  }
  @Post(":id/restore") restore(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: TaskRevisionDto,
  ) {
    return this.tasks.change(a, p, id, "restore", d);
  }
  @Post() create(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(actor, projectId, dto);
  }
  @Patch(":taskId/assignee") assign(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() dto: AssignTaskDto,
  ) {
    return this.tasks.assign(actor, projectId, taskId, dto.assigneeUserId);
  }
}
@Module({
  imports: [ProjectsModule, PlanAdapterModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
