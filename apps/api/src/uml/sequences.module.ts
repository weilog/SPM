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
  Query,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { User, UmlSequence } from "@spm/shared";
import { Actor } from "../common/security";
import { DbService } from "../db/db.module";
import { ProjectsModule, ProjectsService } from "../projects/projects.module";

class ParticipantDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,40}$/) id!: string;
  @IsString() @Length(1, 100) name!: string;
}
class MessageDto {
  @IsString() @Length(1, 40) fromId!: string;
  @IsString() @Length(1, 40) toId!: string;
  @IsString() @Length(1, 200) label!: string;
  @IsIn(["call", "return"]) kind!: "call" | "return";
}
class SequenceDto {
  @IsString() @Length(1, 200) name!: string;
  @IsString() @Length(0, 10000) description!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants!: ParticipantDto[];
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages!: MessageDto[];
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  storyIds!: number[];
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  useCaseIds!: number[];
  @IsOptional() @IsInt() @Min(0) revision?: number;
}
class VersionQuery {
  @Type(() => Number) @IsInt() @Min(0) revision!: number;
}
const include = { storyLinks: true, useCaseLinks: true } as const;
@Injectable()
export class SequencesService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
  ) {}
  private present(row: {
    storyLinks: { storyId: number }[];
    useCaseLinks: { nodeId: number }[];
    [key: string]: unknown;
  }): UmlSequence {
    const { storyLinks, useCaseLinks, ...rest } = row;
    return {
      ...rest,
      storyIds: storyLinks.map((l) => l.storyId),
      useCaseIds: useCaseLinks.map((l) => l.nodeId),
    } as unknown as UmlSequence;
  }
  async list(a: User, p: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, false, tx);
      return (
        await tx.umlSequence.findMany({
          where: { projectId: p },
          include,
          orderBy: { id: "asc" },
        })
      ).map((r) => this.present(r));
    });
  }
  async save(a: User, p: number, d: SequenceDto, id?: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const current =
        id === undefined
          ? null
          : await tx.umlSequence.findFirst({ where: { projectId: p, id } });
      if (id !== undefined && !current)
        throw new NotFoundException("时序场景不存在");
      if (current && current.revision !== d.revision)
        throw new ConflictException("场景已更新，请刷新后重新编辑");
      const ids = new Set(d.participants.map((x) => x.id));
      if (
        !d.name.trim() ||
        ids.size !== d.participants.length ||
        d.participants.some((x) => !x.name.trim()) ||
        d.messages.some(
          (x) => !ids.has(x.fromId) || !ids.has(x.toId) || !x.label.trim(),
        )
      )
        throw new BadRequestException("请检查参与者名称、唯一标识和消息引用");
      if (
        (await tx.userStory.count({
          where: { projectId: p, id: { in: d.storyIds } },
        })) !== d.storyIds.length ||
        (await tx.umlNode.count({
          where: { projectId: p, kind: "USE_CASE", id: { in: d.useCaseIds } },
        })) !== d.useCaseIds.length
      )
        throw new BadRequestException("关联故事或用例不属于当前项目");
      const data = {
        name: d.name.trim(),
        description: d.description,
        participants: d.participants.map((x) => ({
          id: x.id,
          name: x.name.trim(),
        })),
        messages: d.messages.map((x) => ({ ...x, label: x.label.trim() })),
      };
      const row = current
        ? await tx.umlSequence.update({
            where: { id: current.id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await tx.umlSequence.create({ data: { ...data, projectId: p } });
      await tx.umlSequenceStory.deleteMany({
        where: { projectId: p, sequenceId: row.id },
      });
      await tx.umlSequenceUseCase.deleteMany({
        where: { projectId: p, sequenceId: row.id },
      });
      if (d.storyIds.length)
        await tx.umlSequenceStory.createMany({
          data: d.storyIds.map((storyId) => ({
            projectId: p,
            sequenceId: row.id,
            storyId,
          })),
        });
      if (d.useCaseIds.length)
        await tx.umlSequenceUseCase.createMany({
          data: d.useCaseIds.map((nodeId) => ({
            projectId: p,
            sequenceId: row.id,
            nodeId,
          })),
        });
      return this.present(
        await tx.umlSequence.findUniqueOrThrow({
          where: { id: row.id },
          include,
        }),
      );
    });
  }
  async remove(a: User, p: number, id: number, revision: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const row = await tx.umlSequence.findFirst({
        where: { projectId: p, id },
      });
      if (!row) throw new NotFoundException("时序场景不存在");
      if (row.revision !== revision)
        throw new ConflictException("场景已更新，请刷新后重试");
      await tx.umlSequence.delete({ where: { id } });
      return { ok: true };
    });
  }
}
@Controller("projects/:projectId/uml-sequences")
class SequencesController {
  constructor(private readonly service: SequencesService) {}
  @Get() list(@Actor() a: User, @Param("projectId", ParseIntPipe) p: number) {
    return this.service.list(a, p);
  }
  @Post() create(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: SequenceDto,
  ) {
    return this.service.save(a, p, d);
  }
  @Patch(":id") edit(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: SequenceDto,
  ) {
    return this.service.save(a, p, d, id);
  }
  @Delete(":id") remove(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Query() q: VersionQuery,
  ) {
    return this.service.remove(a, p, id, q.revision);
  }
}
@Module({
  imports: [ProjectsModule],
  providers: [SequencesService],
  controllers: [SequencesController],
})
export class SequencesModule {}
