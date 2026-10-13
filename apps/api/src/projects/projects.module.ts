import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, MaxLength, Min, ValidateIf } from 'class-validator';
import type { User } from '@spm/shared';
import { Prisma } from '../generated/prisma/client';
import { Actor, userSelect } from '../common/security';
import { DbService } from '../db/db.module';

export class CreateProjectDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 200) name!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(10000) description?: string;
  @IsOptional() @IsInt() @Min(1) managerId?: number;
}
class AddMemberDto { @IsInt() @Min(1) userId!: number; }
export type Database = Prisma.TransactionClient;
@Injectable()
export class ProjectsService {
  constructor(private readonly db: DbService) {}
  async currentActor(actor: User, db: Database = this.db) {
    const current = await db.user.findUnique({ where: { id: actor.id }, select: userSelect });
    if (!current?.active) throw new ForbiddenException('账户已停用');
    return current;
  }
  canManage(actor: User, project: { managerId: number }) { return actor.role === 'ADMIN' || (actor.role === 'MANAGER' && actor.id === project.managerId); }
  async authorized(actor: User, id: number, manage = false, db: Database = this.db) {
    actor = await this.currentActor(actor, db);
    const project = await db.project.findFirst({ where: { id, ...(actor.role === 'ADMIN' ? {} : { OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }] }) }, include: { manager: { select: userSelect } } });
    if (!project) throw new NotFoundException('项目不存在或无权访问');
    if (manage && !this.canManage(actor, project)) throw new ForbiddenException('无权管理此项目');
    return { ...project, canManage: this.canManage(actor, project) };
  }
  async list(actor: User) {
    actor = await this.currentActor(actor);
    const projects = await this.db.project.findMany({ where: actor.role === 'ADMIN' ? {} : { OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }] }, include: { manager: { select: userSelect } }, orderBy: { id: 'desc' } });
    return projects.map(project => ({ ...project, canManage: this.canManage(actor, project) }));
  }
  async create(actor: User, dto: CreateProjectDto) {
    return this.db.atomic(async tx => {
      actor = await this.currentActor(actor, tx);
      if (!['ADMIN', 'MANAGER'].includes(actor.role)) throw new ForbiddenException('无权创建项目');
      if (actor.role !== 'ADMIN' && dto.managerId !== undefined && dto.managerId !== actor.id) throw new BadRequestException('项目经理只能指定本人');
      const managerId = actor.role === 'ADMIN' ? dto.managerId : actor.id;
      const manager = managerId ? await tx.user.findUnique({ where: { id: managerId } }) : null;
      if (!manager?.active || manager.role !== 'MANAGER') throw new BadRequestException('请选择有效项目经理');
      const project = await tx.project.create({ data: { name: dto.name, description: dto.description, managerId: manager.id, members: { create: { userId: manager.id } } }, include: { manager: { select: userSelect } } });
      return { ...project, canManage: true };
    });
  }
  async members(actor: User, id: number) {
    await this.authorized(actor, id, true);
    return this.db.projectMember.findMany({ where: { projectId: id }, include: { user: { select: userSelect } }, orderBy: { id: 'asc' } });
  }
  async candidates(actor: User, id: number) {
    await this.authorized(actor, id, true);
    return this.db.user.findMany({ where: { active: true, memberships: { none: { projectId: id } } }, select: userSelect, orderBy: { username: 'asc' } });
  }
  async addMember(actor: User, id: number, userId: number) {
    return this.db.atomic(async tx => {
      await this.authorized(actor, id, true, tx);
      if (!await tx.user.findFirst({ where: { id: userId, active: true } })) throw new BadRequestException('只能添加有效用户');
      return tx.projectMember.create({ data: { projectId: id, userId }, include: { user: { select: userSelect } } });
    });
  }
  async removeMember(actor: User, id: number, userId: number) {
    return this.db.atomic(async tx => {
      const project = await this.authorized(actor, id, true, tx);
      if (userId === project.managerId) throw new BadRequestException('不能移除项目经理');
      const member = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId } } });
      if (!member) throw new NotFoundException('本项目成员不存在');
      await tx.task.updateMany({ where: { projectId: id, assigneeUserId: userId }, data: { assigneeUserId: null } });
      await tx.projectMember.delete({ where: { id: member.id } });
      return { ok: true };
    });
  }
}
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly db: DbService) {}
  @Get() list(@Actor() actor: User) { return this.projects.list(actor); }
  @Get('managers') async managers(@Actor() actor: User) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('仅管理员可指定项目经理');
    return this.db.user.findMany({ where: { active: true, role: 'MANAGER' }, select: userSelect });
  }
  @Post() create(@Actor() actor: User, @Body() dto: CreateProjectDto) { return this.projects.create(actor, dto); }
  @Get(':id') detail(@Actor() actor: User, @Param('id', ParseIntPipe) id: number) { return this.projects.authorized(actor, id); }
  @Get(':id/members') members(@Actor() actor: User, @Param('id', ParseIntPipe) id: number) { return this.projects.members(actor, id); }
  @Get(':id/member-candidates') candidates(@Actor() actor: User, @Param('id', ParseIntPipe) id: number) { return this.projects.candidates(actor, id); }
  @Post(':id/members') add(@Actor() actor: User, @Param('id', ParseIntPipe) id: number, @Body() dto: AddMemberDto) { return this.projects.addMember(actor, id, dto.userId); }
  @Delete(':id/members/:userId') remove(@Actor() actor: User, @Param('id', ParseIntPipe) id: number, @Param('userId', ParseIntPipe) userId: number) { return this.projects.removeMember(actor, id, userId); }
}
@Module({ controllers: [ProjectsController], providers: [ProjectsService], exports: [ProjectsService] })
export class ProjectsModule {}
