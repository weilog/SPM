import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import type { User } from '@spm/shared';
import { DbService } from '../db/db.module';
import { Actor } from '../common/security';
import { ProjectsModule, ProjectsService } from '../projects/projects.module';

class CreateRequirementDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 200) title!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(10000) description?: string;
}
class UpdateRequirementDto {
  @ValidateIf((_object, value) => value !== undefined) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 200) title?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(10000) description?: string;
}
@Injectable()
export class RequirementsService {
  constructor(private readonly db: DbService, private readonly projects: ProjectsService) {}
  async list(actor: User, projectId: number) {
    await this.projects.authorized(actor, projectId);
    return this.db.requirement.findMany({ where: { projectId }, orderBy: { id: 'desc' } });
  }
  async detail(actor: User, projectId: number, id: number) {
    await this.projects.authorized(actor, projectId);
    const requirement = await this.db.requirement.findFirst({ where: { id, projectId } });
    if (!requirement) throw new NotFoundException('本项目正式需求不存在');
    return requirement;
  }
  async create(actor: User, projectId: number, dto: CreateRequirementDto) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      return tx.requirement.create({ data: { projectId, title: dto.title, description: dto.description } });
    });
  }
  async update(actor: User, projectId: number, id: number, dto: UpdateRequirementDto) {
    if (dto.title === undefined && dto.description === undefined) throw new BadRequestException('请提供要修改的需求内容');
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      if (!await tx.requirement.findFirst({ where: { id, projectId } })) throw new NotFoundException('本项目正式需求不存在');
      return tx.requirement.update({ where: { id }, data: dto });
    });
  }
}
@Controller('projects/:projectId/requirements')
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}
  @Get() list(@Actor() actor: User, @Param('projectId', ParseIntPipe) projectId: number) { return this.requirements.list(actor, projectId); }
  @Get(':id') detail(@Actor() actor: User, @Param('projectId', ParseIntPipe) projectId: number, @Param('id', ParseIntPipe) id: number) { return this.requirements.detail(actor, projectId, id); }
  @Post() create(@Actor() actor: User, @Param('projectId', ParseIntPipe) projectId: number, @Body() dto: CreateRequirementDto) { return this.requirements.create(actor, projectId, dto); }
  @Patch(':id') update(@Actor() actor: User, @Param('projectId', ParseIntPipe) projectId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRequirementDto) { return this.requirements.update(actor, projectId, id, dto); }
}
@Module({ imports: [ProjectsModule], controllers: [RequirementsController], providers: [RequirementsService] })
export class RequirementsModule {}
