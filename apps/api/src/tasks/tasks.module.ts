import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, MaxLength, Min, ValidateIf } from 'class-validator';
import type { User } from '@spm/shared';
import { DbService } from '../db/db.module';
import { Actor } from '../common/security';
import { Database, ProjectsModule, ProjectsService } from '../projects/projects.module';

class CreateTaskDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 200) title!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(10000) description?: string;
  @IsOptional() @IsInt() @Min(1) assigneeUserId?: number | null;
}
class AssignTaskDto {
  @ValidateIf((_object, value) => value !== null) @IsInt() @Min(1) assigneeUserId!: number | null;
}
@Injectable()
export class TasksService {
  constructor(private readonly db: DbService, private readonly projects: ProjectsService) {}
  async validateAssignee(tx: Database, projectId: number, userId: number | null | undefined) {
    if (userId == null) return;
    if (!await tx.projectMember.findFirst({ where: { projectId, userId, user: { active: true } } })) throw new BadRequestException('负责人必须是当前项目的有效成员');
  }
  async list(actor: User, projectId: number) {
    await this.projects.authorized(actor, projectId, true);
    // Minimal manager-only assignment index, not a task status dashboard.
    return this.db.task.findMany({ where: { projectId }, orderBy: { id: 'desc' } });
  }
  async create(actor: User, projectId: number, dto: CreateTaskDto) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      await this.validateAssignee(tx, projectId, dto.assigneeUserId);
      return tx.task.create({ data: { projectId, title: dto.title, description: dto.description, assigneeUserId: dto.assigneeUserId } });
    });
  }
  async assign(actor: User, projectId: number, taskId: number, userId: number | null) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      if (!await tx.task.findFirst({ where: { id: taskId, projectId } })) throw new NotFoundException('本项目任务不存在');
      await this.validateAssignee(tx, projectId, userId);
      return tx.task.update({ where: { id: taskId }, data: { assigneeUserId: userId } });
    });
  }
}
@Controller('projects/:projectId/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Get() list(@Actor() actor: User, @Param('projectId', ParseIntPipe) projectId: number) { return this.tasks.list(actor, projectId); }
  @Post() create(@Actor() actor: User, @Param('projectId', ParseIntPipe) projectId: number, @Body() dto: CreateTaskDto) { return this.tasks.create(actor, projectId, dto); }
  @Patch(':taskId/assignee') assign(@Actor() actor: User, @Param('projectId', ParseIntPipe) projectId: number, @Param('taskId', ParseIntPipe) taskId: number, @Body() dto: AssignTaskDto) { return this.tasks.assign(actor, projectId, taskId, dto.assigneeUserId); }
}
@Module({ imports: [ProjectsModule], controllers: [TasksController], providers: [TasksService] })
export class TasksModule {}
