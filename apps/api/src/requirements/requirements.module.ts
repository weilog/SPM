import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
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
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import type { User } from "@spm/shared";
import { DbService } from "../db/db.module";
import { Actor } from "../common/security";
import {
  Database,
  ProjectsModule,
  ProjectsService,
} from "../projects/projects.module";

class CreateRequirementDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(10000)
  acceptanceCriteria?: string;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  parentId?: number | null;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  title!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  storyIds?: number[];
}
class UpdateRequirementDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(10000)
  acceptanceCriteria?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) revision?: number;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  parentId?: number | null;
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  title?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  storyIds?: number[];
}
const links = { storyLinks: { select: { storyId: true } } } as const;
function present<T extends { storyLinks: { storyId: number }[] }>(item: T) {
  const { storyLinks, ...requirement } = item;
  return {
    ...requirement,
    storyIds: storyLinks.map((link) => link.storyId).sort((a, b) => a - b),
  };
}
@Injectable()
export class RequirementsService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
  ) {}
  async list(actor: User, projectId: number) {
    await this.projects.authorized(actor, projectId);
    return (
      await this.db.requirement.findMany({
        where: { projectId },
        orderBy: { id: "desc" },
        include: links,
      })
    ).map(present);
  }
  async detail(actor: User, projectId: number, id: number) {
    await this.projects.authorized(actor, projectId);
    const requirement = await this.db.requirement.findFirst({
      where: { id, projectId },
      include: links,
    });
    if (!requirement) throw new NotFoundException("本项目正式需求不存在");
    return present(requirement);
  }
  async create(
    actor: User,
    projectId: number,
    dto: CreateRequirementDto,
    transaction?: Database,
  ) {
    const work = async (tx: Database) => {
      await this.projects.authorized(actor, projectId, true, tx);
      const requirement = await tx.requirement.create({
        data: {
          projectId,
          title: dto.title,
          description: dto.description,
          acceptanceCriteria: dto.acceptanceCriteria,
        },
      });
      if (dto.parentId != null) {
        await this.hierarchy(tx, projectId, requirement.id, dto.parentId);
        await tx.requirement.update({
          where: { id: requirement.id },
          data: { parentId: dto.parentId },
        });
      }
      await this.relate(tx, projectId, requirement.id, dto.storyIds);
      return present(
        await tx.requirement.findUniqueOrThrow({
          where: { id: requirement.id },
          include: links,
        }),
      );
    };
    return transaction ? work(transaction) : this.db.atomic(work);
  }
  async update(
    actor: User,
    projectId: number,
    id: number,
    dto: UpdateRequirementDto,
    transaction?: Database,
  ) {
    if (
      dto.acceptanceCriteria === undefined &&
      dto.title === undefined &&
      dto.description === undefined &&
      dto.storyIds === undefined &&
      dto.parentId === undefined
    )
      throw new BadRequestException("请提供要修改的需求内容");
    const work = async (tx: Database) => {
      await this.projects.authorized(actor, projectId, true, tx);
      const current = await tx.requirement.findFirst({
        where: { id, projectId },
      });
      if (!current) throw new NotFoundException("本项目正式需求不存在");
      if (dto.revision !== undefined && dto.revision !== current.revision)
        throw new ConflictException("需求已被修改，请刷新");
      const { storyIds, revision, ...data } = dto;
      if (dto.parentId !== undefined)
        await this.hierarchy(tx, projectId, id, dto.parentId);
      await this.relate(tx, projectId, id, storyIds);
      return present(
        await tx.requirement.update({
          where: { id },
          data: { ...data, revision: { increment: 1 } },
          include: links,
        }),
      );
    };
    return transaction ? work(transaction) : this.db.atomic(work);
  }
  private async hierarchy(
    tx: Database,
    projectId: number,
    id: number,
    parentId: number | null,
  ) {
    const rows = await tx.requirement.findMany({
      where: { projectId },
      select: { id: true, parentId: true },
    });
    if (parentId !== null && !rows.some((r) => r.id === parentId))
      throw new BadRequestException("上级需求必须属于当前项目");
    const parents = new Map(
      rows.map((r) => [r.id, r.id === id ? parentId : r.parentId]),
    );
    for (const row of rows) {
      const seen = new Set<number>();
      let cursor: number | null = row.id;
      while (cursor !== null) {
        if (seen.has(cursor))
          throw new BadRequestException("需求层级不能循环引用");
        seen.add(cursor);
        if (seen.size > 3)
          throw new BadRequestException("需求最多支持三级嵌套");
        cursor = parents.get(cursor) ?? null;
      }
    }
  }
  private async relate(
    tx: Database,
    projectId: number,
    requirementId: number,
    storyIds?: number[],
  ) {
    if (storyIds === undefined) return;
    if (
      (await tx.userStory.count({
        where: { projectId, id: { in: storyIds } },
      })) !== storyIds.length
    )
      throw new BadRequestException("关联故事必须属于当前项目");
    const previous = await tx.storyRequirement.findMany({
      where: { projectId, requirementId },
    });
    await tx.storyRequirement.deleteMany({
      where: { projectId, requirementId },
    });
    await tx.storyRequirement.createMany({
      data: storyIds.map((storyId) => ({ projectId, requirementId, storyId })),
    });
    // Invalidate story editors after a reverse-side relation change.
    await tx.userStory.updateMany({
      where: {
        projectId,
        id: {
          in: [
            ...new Set([...storyIds, ...previous.map((link) => link.storyId)]),
          ],
        },
      },
      data: { revision: { increment: 1 } },
    });
  }
}
@Controller("projects/:projectId/requirements")
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}
  @Get() list(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
  ) {
    return this.requirements.list(actor, projectId);
  }
  @Get(":id") detail(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.requirements.detail(actor, projectId, id);
  }
  @Post() create(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.requirements.create(actor, projectId, dto);
  }
  @Patch(":id") update(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) projectId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.requirements.update(actor, projectId, id, dto);
  }
}
@Module({
  imports: [ProjectsModule],
  controllers: [RequirementsController],
  providers: [RequirementsService],
  exports: [RequirementsService],
})
export class RequirementsModule {}
