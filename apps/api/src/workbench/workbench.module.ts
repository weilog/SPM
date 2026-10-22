import {
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Sse,
} from "@nestjs/common";
import { Request } from "express";
import { IsIn, IsString, Length } from "class-validator";
import { concatMap, interval, startWith, takeWhile } from "rxjs";
import { createHash } from "node:crypto";
import type { ResolvedRelations, User } from "@spm/shared";
import { Actor, tokenHash } from "../common/security";
import { DbService } from "../db/db.module";
import { ProjectsModule, ProjectsService } from "../projects/projects.module";
class FocusQuery {
  @IsIn(["story", "task", "planItem", "umlUseCase"]) entityType!:
    | "story"
    | "task"
    | "planItem"
    | "umlUseCase";
  @IsString() @Length(1, 100) entityId!: string;
}
@Injectable()
class WorkbenchService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
  ) {}
  async resolve(a: User, p: number, q: FocusQuery): Promise<ResolvedRelations> {
    return this.db.atomic(async (tx) => {
      const project = await this.projects.authorized(a, p, false, tx);
      const tasks = await tx.task.findMany({
        where: {
          projectId: p,
          archivedAt: null,
          ...(!project.canManage ? { assigneeUserId: a.id } : {}),
        },
        include: { storyLinks: true, planLinks: true },
      });
      const stories = await tx.userStory.findMany({
        where: { projectId: p },
        select: { id: true },
      });
      const uses = await tx.umlNode.findMany({
        where: { projectId: p, kind: "USE_CASE" },
        include: { storyLinks: true },
      });
      const s = new Set<number>(),
        t = new Set<number>(),
        u = new Set<number>(),
        plans = new Set<string>();
      const id = Number(q.entityId);
      if (q.entityType === "story" && stories.some((x) => x.id === id))
        s.add(id);
      else if (q.entityType === "task" && tasks.some((x) => x.id === id))
        t.add(id);
      else if (q.entityType === "umlUseCase" && uses.some((x) => x.id === id))
        u.add(id);
      else if (
        q.entityType === "planItem" &&
        tasks.some((x) => x.planLinks.some((l) => l.planId === q.entityId))
      )
        plans.add(q.entityId);
      else throw new NotFoundException("焦点不存在或无权访问");
      let previous = -1;
      while (previous !== s.size + t.size + u.size + plans.size) {
        previous = s.size + t.size + u.size + plans.size;
        for (const task of tasks)
          if (
            t.has(task.id) ||
            task.storyLinks.some((l) => s.has(l.storyId)) ||
            task.planLinks.some((l) => plans.has(l.planId))
          ) {
            t.add(task.id);
            task.storyLinks.forEach((l) => s.add(l.storyId));
            task.planLinks.forEach((l) => plans.add(l.planId));
          }
        for (const node of uses)
          if (u.has(node.id) || node.storyLinks.some((l) => s.has(l.storyId))) {
            u.add(node.id);
            node.storyLinks.forEach((l) => s.add(l.storyId));
          }
      }
      return {
        stories: [...s],
        tasks: [...t],
        planItems: [...plans],
        umlUseCases: [...u],
      };
    });
  }
  async signal(a: User, p: number, token: string) {
    const session = await this.db.session.findUnique({
      where: { id: tokenHash(token) },
    });
    if (!session || session.userId !== a.id || session.expiresAt <= new Date())
      return null;
    try {
      return await this.db.atomic(async (tx) => {
        const project = await this.projects.authorized(a, p, false, tx);
        const [requirements, stories, tasks, diagrams, members] =
          await Promise.all([
            tx.requirement.findMany({
              where: { projectId: p },
              select: { id: true, parentId: true, updatedAt: true },
            }),
            tx.userStory.findMany({
              where: { projectId: p },
              select: { id: true, revision: true },
            }),
            tx.task.findMany({
              where: {
                projectId: p,
                ...(!project.canManage ? { assigneeUserId: a.id } : {}),
              },
              select: {
                id: true,
                revision: true,
                assigneeUserId: true,
                archivedAt: true,
              },
            }),
            tx.umlDiagram.findMany({
              where: { projectId: p },
              select: { id: true, revision: true },
            }),
            tx.projectMember.findMany({
              where: { projectId: p },
              select: { id: true, role: true },
            }),
          ]);
        const goals = await tx.productGoal.findMany({
          where: { projectId: p },
          select: { id: true, revision: true },
        });
        const epics = await tx.epic.findMany({
          where: { projectId: p },
          select: { id: true, revision: true },
        });
        return createHash("sha256")
          .update(
            JSON.stringify({
              requirements,
              stories,
              tasks,
              diagrams,
              members,
              goals,
              epics,
            }),
          )
          .digest("hex");
      });
    } catch {
      return null;
    }
  }
}
@Controller("projects/:projectId")
class WorkbenchController {
  constructor(private readonly service: WorkbenchService) {}
  @Get("relations/resolve") resolve(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Query() q: FocusQuery,
  ) {
    return this.service.resolve(a, p, q);
  }
  @Sse("events") events(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Req() req: Request,
  ) {
    let previous = "";
    return interval(1000).pipe(
      startWith(0),
      concatMap(async () => {
        const revision = await this.service.signal(
          a,
          p,
          String(req.cookies?.spm_session ?? ""),
        );
        if (!revision) return { type: "revoked", data: { projectId: p } };
        const changed = revision !== previous;
        previous = revision;
        return {
          type: changed ? "changed" : "heartbeat",
          data: { projectId: p, revision },
        };
      }),
      takeWhile((event) => event.type !== "revoked", true),
    );
  }
}
@Module({
  imports: [ProjectsModule],
  providers: [WorkbenchService],
  controllers: [WorkbenchController],
})
export class WorkbenchModule {}
