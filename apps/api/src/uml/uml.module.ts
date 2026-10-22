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
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { Transform } from "class-transformer";
import type { User } from "@spm/shared";
import { Actor } from "../common/security";
import { DbService } from "../db/db.module";
import {
  Database,
  ProjectsModule,
  ProjectsService,
} from "../projects/projects.module";
class NameDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  name!: string;
}
class NodeDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  name?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(["ACTOR", "USE_CASE"]) kind?:
    | "ACTOR"
    | "USE_CASE";
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(5000)
  x?: number;
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(5000)
  y?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) revision?: number;
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  storyIds?: number[];
}
class EdgeDto {
  @IsInt() @Min(1) fromId!: number;
  @IsInt() @Min(1) toId!: number;
  @IsIn(["association", "include", "extend"]) kind!:
    | "association"
    | "include"
    | "extend";
}
class BoundaryDto extends NameDto {
  @IsNumber() @Min(0) @Max(5000) x!: number;
  @IsNumber() @Min(0) @Max(5000) y!: number;
  @IsNumber() @Min(100) @Max(5000) width!: number;
  @IsNumber() @Min(100) @Max(5000) height!: number;
  @IsInt() @Min(0) revision!: number;
}
const include = {
  nodes: { include: { storyLinks: { select: { storyId: true } } } },
  edges: true,
} as const;
@Injectable()
export class UmlService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
  ) {}
  private async diagram(tx: Database, p: number, id: number) {
    const d = await tx.umlDiagram.findFirst({
      where: { projectId: p, id },
      include,
    });
    if (!d) throw new NotFoundException("本项目用例图不存在");
    return d;
  }
  private present(d: Awaited<ReturnType<UmlService["diagram"]>>) {
    return {
      ...d,
      nodes: d.nodes.map(({ storyLinks, ...n }) => ({
        ...n,
        storyIds: storyLinks.map((l) => l.storyId),
      })),
    };
  }
  async list(a: User, p: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, false, tx);
      if (!(await tx.umlDiagram.count({ where: { projectId: p } })))
        await tx.umlDiagram.create({
          data: { projectId: p, name: "项目总体用例图" },
        });
      return (
        await tx.umlDiagram.findMany({
          where: { projectId: p },
          include,
          orderBy: { id: "asc" },
        })
      ).map((d) => this.present(d));
    });
  }
  async create(a: User, p: number, d: NameDto) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      return this.present(
        await tx.umlDiagram.create({
          data: { projectId: p, name: d.name },
          include,
        }),
      );
    });
  }
  async node(a: User, p: number, id: number, d: NodeDto, nodeId?: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const diagram = await this.diagram(tx, p, id);
      const current = nodeId
        ? diagram.nodes.find((n) => n.id === nodeId)
        : null;
      if (nodeId && !current) throw new NotFoundException("本图节点不存在");
      if (current && d.revision !== current.revision)
        throw new ConflictException("节点已更新，请刷新后重试");
      if (
        !current &&
        (!d.name || !d.kind || d.x === undefined || d.y === undefined)
      )
        throw new BadRequestException("请提供名称、节点类型和坐标");
      if (current && d.kind && current.kind !== d.kind)
        throw new BadRequestException("不能改变现有节点的类型");
      if ((d.kind ?? current?.kind) === "ACTOR" && d.storyIds?.length)
        throw new BadRequestException("只有用例可以关联故事");
      if (
        d.storyIds &&
        (await tx.userStory.count({
          where: { projectId: p, id: { in: d.storyIds } },
        })) !== d.storyIds.length
      )
        throw new BadRequestException("故事必须属于当前项目");
      const data = { name: d.name, description: d.description, x: d.x, y: d.y };
      const node = current
        ? await tx.umlNode.update({
            where: { id: nodeId },
            data: { ...data, revision: { increment: 1 } },
          })
        : await tx.umlNode.create({
            data: {
              ...data,
              name: d.name!,
              kind: d.kind!,
              x: d.x!,
              y: d.y!,
              projectId: p,
              diagramId: id,
            },
          });
      if (d.storyIds !== undefined) {
        await tx.umlStory.deleteMany({
          where: { projectId: p, nodeId: node.id },
        });
        await tx.umlStory.createMany({
          data: d.storyIds.map((storyId) => ({
            projectId: p,
            nodeId: node.id,
            storyId,
          })),
        });
      }
      await tx.umlDiagram.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      return this.present(await this.diagram(tx, p, id));
    });
  }
  async removeNode(a: User, p: number, id: number, nodeId: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const d = await this.diagram(tx, p, id);
      if (!d.nodes.some((n) => n.id === nodeId))
        throw new NotFoundException("节点不存在");
      await tx.umlEdge.deleteMany({
        where: {
          projectId: p,
          diagramId: id,
          OR: [{ fromId: nodeId }, { toId: nodeId }],
        },
      });
      await tx.umlNode.delete({ where: { id: nodeId } });
      await tx.umlDiagram.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      return this.present(await this.diagram(tx, p, id));
    });
  }
  async edge(a: User, p: number, id: number, d: EdgeDto, edgeId?: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const diagram = await this.diagram(tx, p, id);
      const from = diagram.nodes.find((n) => n.id === d.fromId),
        to = diagram.nodes.find((n) => n.id === d.toId);
      if (!from || !to || from.id === to.id)
        throw new BadRequestException("连线端点必须是本图不同节点");
      if (
        d.kind === "association"
          ? from.kind === to.kind
          : from.kind !== "USE_CASE" || to.kind !== "USE_CASE"
      )
        throw new BadRequestException(
          "关联连接参与者和用例；include/extend连接两个用例",
        );
      if (edgeId) {
        if (!diagram.edges.some((e) => e.id === edgeId))
          throw new NotFoundException("关系不存在");
        await tx.umlEdge.update({ where: { id: edgeId }, data: d });
      } else
        await tx.umlEdge.create({
          data: { ...d, projectId: p, diagramId: id },
        });
      await tx.umlDiagram.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      return this.present(await this.diagram(tx, p, id));
    });
  }
  async removeEdge(a: User, p: number, id: number, edgeId: number) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const d = await this.diagram(tx, p, id);
      if (!d.edges.some((e) => e.id === edgeId))
        throw new NotFoundException("关系不存在");
      await tx.umlEdge.delete({ where: { id: edgeId } });
      await tx.umlDiagram.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      return this.present(await this.diagram(tx, p, id));
    });
  }
  async boundary(a: User, p: number, id: number, d: BoundaryDto) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const current = await this.diagram(tx, p, id);
      if (current.revision !== d.revision)
        throw new ConflictException("图已更新，请刷新后重试");
      const { revision, ...boundary } = d;
      await tx.umlDiagram.update({
        where: { id },
        data: { boundary, revision: { increment: 1 } },
      });
      return this.present(await this.diagram(tx, p, id));
    });
  }
}
@Controller("projects/:projectId/uml-diagrams")
class UmlController {
  constructor(private readonly s: UmlService) {}
  @Get() list(@Actor() a: User, @Param("projectId", ParseIntPipe) p: number) {
    return this.s.list(a, p);
  }
  @Post() create(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: NameDto,
  ) {
    return this.s.create(a, p, d);
  }
  @Post(":id/nodes") node(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: NodeDto,
  ) {
    return this.s.node(a, p, id, d);
  }
  @Patch(":id/nodes/:nodeId") edit(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Param("nodeId", ParseIntPipe) n: number,
    @Body() d: NodeDto,
  ) {
    return this.s.node(a, p, id, d, n);
  }
  @Delete(":id/nodes/:nodeId") remove(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Param("nodeId", ParseIntPipe) n: number,
  ) {
    return this.s.removeNode(a, p, id, n);
  }
  @Post(":id/edges") edge(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: EdgeDto,
  ) {
    return this.s.edge(a, p, id, d);
  }
  @Patch(":id/edges/:edgeId") edgeEdit(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Param("edgeId", ParseIntPipe) e: number,
    @Body() d: EdgeDto,
  ) {
    return this.s.edge(a, p, id, d, e);
  }
  @Delete(":id/edges/:edgeId") edgeRemove(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Param("edgeId", ParseIntPipe) e: number,
  ) {
    return this.s.removeEdge(a, p, id, e);
  }
  @Patch(":id/boundary") boundary(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: BoundaryDto,
  ) {
    return this.s.boundary(a, p, id, d);
  }
}
@Module({
  imports: [ProjectsModule],
  providers: [UmlService],
  controllers: [UmlController],
})
export class UmlModule {}
