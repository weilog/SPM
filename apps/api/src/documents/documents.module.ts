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
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
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
  Min,
  ValidateIf,
} from "class-validator";
import type { User } from "@spm/shared";
import { Actor } from "../common/security";
import { DbService } from "../db/db.module";
import {
  ProjectsModule,
  ProjectsService,
  Database,
} from "../projects/projects.module";
const entrySelect = {
  id: true,
  projectId: true,
  parentId: true,
  kind: true,
  name: true,
  mime: true,
  size: true,
  ownerUserId: true,
  ownerName: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
} as const;
class FolderDto {
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsInt() @Min(1) parentId?: number | null;
}
class EditDocumentDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 200)
  name?: string;
  @IsOptional() @IsInt() @Min(1) parentId?: number | null;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) revision?: number;
}
class BatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];
  @IsIn(["move", "delete"]) action!: "move" | "delete";
  @IsOptional() @IsInt() @Min(1) parentId?: number | null;
}
const allowed =
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|png|jpg|jpeg|gif|webp|txt|md|csv|json|zip)$/i;
const mime = (name: string) =>
  ({
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    txt: "text/plain; charset=utf-8",
    md: "text/plain; charset=utf-8",
    csv: "text/plain; charset=utf-8",
    json: "text/plain; charset=utf-8",
  })[name.split(".").pop()!.toLowerCase()] || "application/octet-stream";
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
  ) {}
  private name(value: string) {
    const n = value.trim();
    if (!n || /[\\/\x00-\x1f]/.test(n) || n === "." || n === "..")
      throw new BadRequestException("请输入有效名称，不能包含斜杠或控制字符");
    return n;
  }
  private async parent(tx: Database, p: number, parentId: number | null) {
    if (
      parentId !== null &&
      !(await tx.projectDocument.findFirst({
        where: { id: parentId, projectId: p, kind: "FOLDER" },
      }))
    )
      throw new BadRequestException("目标文件夹不存在或不属于当前项目");
  }
  private async unique(
    tx: Database,
    p: number,
    parentId: number | null,
    name: string,
    except?: number,
  ) {
    if (
      await tx.projectDocument.findFirst({
        where: {
          projectId: p,
          parentId,
          name: { equals: name, mode: "insensitive" },
          ...(except ? { id: { not: except } } : {}),
        },
      })
    )
      throw new ConflictException("目标目录已存在同名文件或文件夹");
  }
  async list(a: User, p: number) {
    await this.projects.authorized(a, p);
    return this.db.projectDocument.findMany({
      where: { projectId: p },
      select: entrySelect,
      orderBy: [{ kind: "desc" }, { name: "asc" }],
    });
  }
  async folder(a: User, p: number, d: FolderDto) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const parentId = d.parentId ?? null,
        name = this.name(d.name);
      await this.parent(tx, p, parentId);
      await this.unique(tx, p, parentId, name);
      return tx.projectDocument.create({
        data: {
          projectId: p,
          parentId,
          name,
          kind: "FOLDER",
          ownerUserId: a.id,
          ownerName: a.username,
        },
        select: entrySelect,
      });
    });
  }
  async upload(
    a: User,
    p: number,
    parent: string | undefined,
    file?: { originalname: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException("请选择文件");
    const name = this.name(
      Buffer.from(file.originalname, "latin1")
        .toString("utf8")
        .includes("\uFFFD")
        ? file.originalname
        : Buffer.from(file.originalname, "latin1").toString("utf8"),
    );
    if (!allowed.test(name)) throw new BadRequestException("不支持此文件类型");
    if (file.size > 20 * 1024 * 1024)
      throw new BadRequestException("文件超过20MB上限");
    const parentId = parent && parent !== "null" ? Number(parent) : null;
    if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId <= 0))
      throw new BadRequestException("文件夹编号无效");
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      await this.parent(tx, p, parentId);
      let next = name,
        seq = 1;
      while (
        await tx.projectDocument.findFirst({
          where: {
            projectId: p,
            parentId,
            name: { equals: next, mode: "insensitive" },
          },
        })
      ) {
        const dot = name.lastIndexOf(".");
        next = `${name.slice(0, dot)} (${seq++})${name.slice(dot)}`;
      }
      return tx.projectDocument.create({
        data: {
          projectId: p,
          parentId,
          name: next,
          kind: "FILE",
          mime: mime(name),
          size: file.size,
          content: new Uint8Array(file.buffer),
          ownerUserId: a.id,
          ownerName: a.username,
        },
        select: entrySelect,
      });
    });
  }
  async edit(a: User, p: number, id: number, d: EditDocumentDto) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const current = await tx.projectDocument.findFirst({
        where: { id, projectId: p },
      });
      if (!current) throw new NotFoundException("文件不存在");
      if (d.revision !== undefined && d.revision !== current.revision)
        throw new ConflictException("文档已更新，请刷新后重试");
      const parentId = d.parentId === undefined ? current.parentId : d.parentId,
        name = d.name === undefined ? current.name : this.name(d.name);
      await this.parent(tx, p, parentId);
      const all = await tx.projectDocument.findMany({
        where: { projectId: p, kind: "FOLDER" },
        select: { id: true, parentId: true },
      });
      let at = parentId;
      const visited = new Set<number>();
      while (at !== null) {
        if (at === id || visited.has(at))
          throw new BadRequestException("不能移动到自身或子文件夹");
        visited.add(at);
        at = all.find((x) => x.id === at)?.parentId ?? null;
      }
      await this.unique(tx, p, parentId, name, id);
      return tx.projectDocument.update({
        where: { id },
        data: {
          name,
          parentId,
          ...(current.kind === "FILE" ? { mime: mime(name) } : {}),
          revision: { increment: 1 },
        },
        select: entrySelect,
      });
    });
  }
  async batch(a: User, p: number, d: BatchDto) {
    return this.db.atomic(async (tx) => {
      await this.projects.authorized(a, p, true, tx);
      const all = await tx.projectDocument.findMany({
        where: { projectId: p },
        select: entrySelect,
      });
      if (d.ids.some((id) => !all.some((x) => x.id === id)))
        throw new NotFoundException("选中内容不存在或不属于当前项目");
      if (d.action === "delete") {
        const ids = new Set(d.ids);
        let before = -1;
        while (before !== ids.size) {
          before = ids.size;
          for (const x of all)
            if (x.parentId !== null && ids.has(x.parentId)) ids.add(x.id);
        }
        await tx.projectDocument.deleteMany({
          where: { projectId: p, id: { in: [...ids] } },
        });
        return { count: ids.size };
      }
      const parentId = d.parentId ?? null;
      await this.parent(tx, p, parentId);
      const ancestors = new Set<number>();
      let at = parentId;
      while (at !== null) {
        if (ancestors.has(at)) throw new BadRequestException("目录循环");
        ancestors.add(at);
        at = all.find((x) => x.id === at)?.parentId ?? null;
      }
      if (d.ids.some((id) => ancestors.has(id)))
        throw new BadRequestException("不能移动到自身或子文件夹");
      const selected = all.filter(
        (x) => d.ids.includes(x.id) && x.parentId !== parentId,
      );
      if (
        new Set(selected.map((x) => x.name.toLowerCase())).size !==
        selected.length
      )
        throw new ConflictException("所选内容存在同名项，请先重命名");
      for (const x of selected)
        await this.unique(tx, p, parentId, x.name, x.id);
      await tx.projectDocument.updateMany({
        where: { projectId: p, id: { in: selected.map((x) => x.id) } },
        data: { parentId, revision: { increment: 1 } },
      });
      return { count: selected.length };
    });
  }
  async content(a: User, p: number, id: number) {
    await this.projects.authorized(a, p);
    const f = await this.db.projectDocument.findFirst({
      where: { id, projectId: p, kind: "FILE" },
    });
    if (!f) throw new NotFoundException("文件不存在");
    return f;
  }
}
@Controller("projects/:projectId/documents")
class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}
  @Get() list(@Actor() a: User, @Param("projectId", ParseIntPipe) p: number) {
    return this.docs.list(a, p);
  }
  @Post("folders") folder(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: FolderDto,
  ) {
    return this.docs.folder(a, p, d);
  }
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Query("parentId") parent: string | undefined,
    @UploadedFile()
    file: { originalname: string; buffer: Buffer; size: number },
  ) {
    return this.docs.upload(a, p, parent, file);
  }
  @Patch(":id") edit(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: EditDocumentDto,
  ) {
    return this.docs.edit(a, p, id, d);
  }
  @Post("batch") batch(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: BatchDto,
  ) {
    return this.docs.batch(a, p, d);
  }
  @Delete(":id") remove(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.docs.batch(a, p, { ids: [id], action: "delete" });
  }
  @Get(":id/content") async content(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Query("download") download: string | undefined,
    @Res() res: Response,
  ) {
    const f = await this.docs.content(a, p, id);
    res.setHeader("Content-Type", f.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader(
      "Content-Disposition",
      `${download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    );
    res.send(Buffer.from(f.content!));
  }
}
@Module({
  imports: [ProjectsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
