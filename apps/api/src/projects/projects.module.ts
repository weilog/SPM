import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import type { User, ProjectRole } from "@spm/shared";
import { Prisma } from "../generated/prisma/client";
import { Actor, userSelect } from "../common/security";
import { DbService } from "../db/db.module";

export class CreateProjectDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  name!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;
  @IsOptional() @IsInt() @Min(1) managerId?: number;
}
class AddMemberDto {
  @IsInt() @Min(1) userId!: number;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["MANAGER", "DEVELOPER", "TESTER"])
  role?: ProjectRole;
}
class UpdateMemberRoleDto {
  @IsIn(["MANAGER", "DEVELOPER", "TESTER"]) role!: ProjectRole;
}
export type Database = Prisma.TransactionClient;
@Injectable()
export class ProjectsService {
  constructor(private readonly db: DbService) {}
  async currentActor(actor: User, db: Database = this.db) {
    const current = await db.user.findUnique({
      where: { id: actor.id },
      select: userSelect,
    });
    if (!current?.active) throw new ForbiddenException("账户已停用");
    return current;
  }
  async canCreate(actor: User, db: Database = this.db) {
    return (
      actor.role === "ADMIN" ||
      actor.role === "MANAGER" ||
      (await db.projectMember.count({
        where: { userId: actor.id, role: "MANAGER" },
      })) > 0
    );
  }
  async creationOptions(actor: User) {
    actor = await this.currentActor(actor);
    return {
      canCreate: await this.canCreate(actor),
      managers:
        actor.role === "ADMIN"
          ? await this.db.user.findMany({
              where: { active: true },
              select: userSelect,
              orderBy: { username: "asc" },
            })
          : [],
    };
  }
  async authorized(
    actor: User,
    id: number,
    manage = false,
    db: Database = this.db,
  ) {
    actor = await this.currentActor(actor, db);
    // No global-role bypass: membership and its project role are authoritative.
    const project = await db.project.findFirst({
      where: { id, members: { some: { userId: actor.id } } },
      include: {
        manager: { select: userSelect },
        members: { where: { userId: actor.id }, select: { role: true } },
      },
    });
    if (!project) throw new NotFoundException("项目不存在或无权访问");
    const { members, ...safeProject } = project;
    const projectRole = members[0].role;
    if (manage && projectRole !== "MANAGER")
      throw new ForbiddenException("无权管理此项目");
    return {
      ...safeProject,
      projectRole,
      canManage: projectRole === "MANAGER",
      canViewOwnTasks: projectRole === "DEVELOPER" || projectRole === "TESTER",
    };
  }
  async list(actor: User) {
    actor = await this.currentActor(actor);
    const projects = await this.db.project.findMany({
      where: { members: { some: { userId: actor.id } } },
      include: {
        manager: { select: userSelect },
        members: { where: { userId: actor.id }, select: { role: true } },
      },
      orderBy: { id: "desc" },
    });
    return projects.map(({ members, ...project }) => ({
      ...project,
      projectRole: members[0].role,
      canManage: members[0].role === "MANAGER",
      canViewOwnTasks: members[0].role !== "MANAGER",
    }));
  }
  async create(actor: User, dto: CreateProjectDto) {
    return this.db.atomic(async (tx) => {
      actor = await this.currentActor(actor, tx);
      if (!(await this.canCreate(actor, tx)))
        throw new ForbiddenException("无权创建项目");
      if (
        actor.role !== "ADMIN" &&
        dto.managerId !== undefined &&
        dto.managerId !== actor.id
      )
        throw new BadRequestException("项目经理只能指定本人");
      const managerId = actor.role === "ADMIN" ? dto.managerId : actor.id;
      const manager = managerId
        ? await tx.user.findUnique({ where: { id: managerId } })
        : null;
      if (!manager?.active)
        throw new BadRequestException("请选择有效用户作为项目经理");
      const project = await tx.project.create({
        data: {
          name: dto.name,
          description: dto.description,
          managerId: manager.id,
          members: { create: { userId: manager.id, role: "MANAGER" } },
        },
        include: { manager: { select: userSelect } },
      });
      // Creation is allowed globally; it does not grant the creator project membership.
      return { ...project, canManage: actor.id === manager.id };
    });
  }
  async members(actor: User, id: number) {
    await this.authorized(actor, id, true);
    return this.db.projectMember.findMany({
      where: { projectId: id },
      include: { user: { select: userSelect } },
      orderBy: { id: "asc" },
    });
  }
  async candidates(actor: User, id: number) {
    await this.authorized(actor, id, true);
    return this.db.user.findMany({
      where: { active: true, memberships: { none: { projectId: id } } },
      select: userSelect,
      orderBy: { username: "asc" },
    });
  }
  async addMember(
    actor: User,
    id: number,
    userId: number,
    role: ProjectRole = "DEVELOPER",
  ) {
    return this.db.atomic(async (tx) => {
      await this.authorized(actor, id, true, tx);
      if (!(await tx.user.findFirst({ where: { id: userId, active: true } })))
        throw new BadRequestException("只能添加有效用户");
      return tx.projectMember.create({
        data: { projectId: id, userId, role },
        include: { user: { select: userSelect } },
      });
    });
  }
  async removeMember(actor: User, id: number, userId: number) {
    return this.db.atomic(async (tx) => {
      const project = await this.authorized(actor, id, true, tx);
      const member = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId: id, userId } },
      });
      if (!member) throw new NotFoundException("本项目成员不存在");
      await tx.task.updateMany({
        where: { projectId: id, assigneeUserId: userId },
        data: { assigneeUserId: null },
      });
      await tx.planStage.updateMany({
        where: { projectId: id, ownerUserId: userId },
        data: { ownerUserId: null, revision: { increment: 1 } },
      });
      await tx.planItem.updateMany({
        where: { projectId: id, ownerUserId: userId },
        data: { ownerUserId: null, revision: { increment: 1 } },
      });
      await tx.projectMember.delete({ where: { id: member.id } });
      await this.keepManager(tx, id, project.managerId);
      return { ok: true };
    });
  }
  async keepManager(tx: Database, projectId: number, currentManagerId: number) {
    const managers = await tx.projectMember.findMany({
      where: { projectId, role: "MANAGER", user: { active: true } },
      orderBy: { id: "asc" },
    });
    if (!managers.length)
      throw new BadRequestException("项目必须保留一个有效项目经理");
    if (!managers.some((member) => member.userId === currentManagerId))
      await tx.project.update({
        where: { id: projectId },
        data: { managerId: managers[0].userId },
      });
  }
  async updateRole(actor: User, id: number, userId: number, role: ProjectRole) {
    return this.db.atomic(async (tx) => {
      const project = await this.authorized(actor, id, true, tx);
      const member = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId: id, userId } },
      });
      if (!member) throw new NotFoundException("本项目成员不存在");
      if (
        role === "MANAGER" &&
        !(await tx.user.findFirst({ where: { id: userId, active: true } }))
      )
        throw new BadRequestException("不能将停用用户设为项目经理");
      const updated = await tx.projectMember.update({
        where: { id: member.id },
        data: { role },
        include: { user: { select: userSelect } },
      });
      await this.keepManager(tx, id, project.managerId);
      return updated;
    });
  }
}
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get() list(@Actor() actor: User) {
    return this.projects.list(actor);
  }
  @Get("creation-options") creationOptions(@Actor() actor: User) {
    return this.projects.creationOptions(actor);
  }
  @Post() create(@Actor() actor: User, @Body() dto: CreateProjectDto) {
    return this.projects.create(actor, dto);
  }
  @Get(":id") detail(
    @Actor() actor: User,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.projects.authorized(actor, id);
  }
  @Get(":id/members") members(
    @Actor() actor: User,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.projects.members(actor, id);
  }
  @Get(":id/member-candidates") candidates(
    @Actor() actor: User,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.projects.candidates(actor, id);
  }
  @Post(":id/members") add(
    @Actor() actor: User,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AddMemberDto,
  ) {
    return this.projects.addMember(actor, id, dto.userId, dto.role);
  }
  @Patch(":id/members/:userId/role") role(
    @Actor() actor: User,
    @Param("id", ParseIntPipe) id: number,
    @Param("userId", ParseIntPipe) userId: number,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.projects.updateRole(actor, id, userId, dto.role);
  }
  @Delete(":id/members/:userId") remove(
    @Actor() actor: User,
    @Param("id", ParseIntPipe) id: number,
    @Param("userId", ParseIntPipe) userId: number,
  ) {
    return this.projects.removeMember(actor, id, userId);
  }
}
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
