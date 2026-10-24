import {
  Body,
  Controller,
  Get,
  Patch,
  Module,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  IsIn,
  IsArray,
  ArrayMaxSize,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import type { User } from "@spm/shared";
import { Actor } from "../common/security";
import { ProjectsModule, ProjectsService } from "../projects/projects.module";
import { AiConfig } from "./ai.config";
import { AiContextService } from "./context.service";
import { AiProvider } from "./provider";
import { AiAnalysisService } from "./analysis.service";
import { AiAnalysisWorker } from "./analysis.worker";
import { ANALYSIS_KINDS, AnalysisKind } from "./ai.types";
import { AiPlanningService } from "./planning.service";
import { AiScenariosService } from "./scenarios.service";
import { RequirementsModule } from "../requirements/requirements.module";
import { StoriesModule } from "../stories/stories.module";
import { TasksModule } from "../tasks/tasks.module";
class RequestKey {
  @IsOptional() @IsUUID() requestKey?: string;
}
class AnalysisRequest extends RequestKey {
  @IsOptional() @IsInt() @Min(1) requirementId?: number;
  @IsOptional() @IsString() @Length(1, 4000) requestText?: string;
  @IsIn(ANALYSIS_KINDS) kind!: AnalysisKind;
  @IsOptional() @IsInt() @Min(1) taskId?: number;
  @IsOptional() @IsString() @Length(1, 100) stageId?: string;
}
class DraftRequest {
  @IsString() @Length(1, 200) title!: string;
  @IsOptional() @IsUUID() runId?: string;
}
class RevisionRequest {
  @IsInt() @Min(0) revision!: number;
}
class SaveDraftRequest extends RevisionRequest {
  @IsString() @Length(1, 200) title!: string;
  @IsArray() @ArrayMaxSize(30) items!: unknown[];
}
class ScenarioRequest {
  @IsArray()
  @ArrayMaxSize(2)
  @IsInt({ each: true })
  @Min(-90, { each: true })
  @Max(90, { each: true })
  shifts!: number[];
}
class HistoryQuery {
  @IsOptional() @IsIn(ANALYSIS_KINDS) kind?: AnalysisKind;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 10;
  @IsOptional() @IsUUID() cursor?: string;
}
@Controller("projects/:projectId/ai")
export class AiController {
  constructor(
    private readonly service: AiAnalysisService,
    private readonly projects: ProjectsService,
    private readonly config: AiConfig,
    private readonly planning: AiPlanningService,
    private readonly scenarios: AiScenariosService,
  ) {}
  @Get("capabilities") async capabilities(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    const project = await this.projects.authorized(a, p);
    return project.canManage
      ? this.config.capabilities()
      : {
          enabled: this.config.enabled,
          canAnalyze: false,
          visibility: "AUTHORIZED_FACTS_ONLY",
        };
  }
  @Post("analyses") create(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: AnalysisRequest,
  ) {
    return this.service
      .create(
        a,
        p,
        d.kind,
        {
          ...(d.taskId ? { taskId: d.taskId } : {}),
          ...(d.stageId ? { stageId: d.stageId } : {}),
          ...(d.requirementId ? { requirementId: d.requirementId } : {}),
          ...(d.requestText ? { requestText: d.requestText } : {}),
        },
        d.requestKey,
      )
      .then((r) => ({
        id: r.id,
        status: r.status,
        kind: r.kind,
        createdAt: r.createdAt,
      }));
  }
  @Get("analyses") history(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Query() q: HistoryQuery,
  ) {
    return this.service.history(a, p, q.limit, q.cursor, q.kind);
  }
  @Get("analyses/:runId") report(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("runId", ParseUUIDPipe) id: string,
  ) {
    return this.service.report(a, p, id);
  }
  @Post("analyses/:runId/retry") retry(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("runId", ParseUUIDPipe) id: string,
    @Body() d: RequestKey,
  ) {
    return this.service.retry(a, p, id, d.requestKey).then((r) => ({
      id: r.id,
      status: r.status,
      retryOf: r.retryOf,
      retryDepth: r.retryDepth,
    }));
  }
  @Post("analyses/:runId/cancel") cancel(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("runId", ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(a, p, id);
  }
  @Post("analyses/:runId/scenarios") simulate(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("runId", ParseUUIDPipe) id: string,
    @Body() d: ScenarioRequest,
  ) {
    return this.scenarios.simulate(a, p, id, d.shifts);
  }
  @Get("drafts") drafts(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    return this.planning.list(a, p);
  }
  @Post("drafts") createDraft(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: DraftRequest,
  ) {
    return this.planning.create(a, p, d.title, d.runId);
  }
  @Get("drafts/:draftId") draft(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("draftId", ParseUUIDPipe) id: string,
  ) {
    return this.planning.read(a, p, id);
  }
  @Patch("drafts/:draftId") saveDraft(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("draftId", ParseUUIDPipe) id: string,
    @Body() d: SaveDraftRequest,
  ) {
    return this.planning.save(a, p, id, d.revision, d.title, d.items);
  }
  @Post("drafts/:draftId/revalidate") revalidate(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("draftId", ParseUUIDPipe) id: string,
    @Body() d: RevisionRequest,
  ) {
    return this.planning.revalidate(a, p, id, d.revision);
  }
  @Post("drafts/:draftId/commit") commit(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("draftId", ParseUUIDPipe) id: string,
    @Body() d: RevisionRequest,
  ) {
    return this.planning.commit(a, p, id, d.revision);
  }
}
@Module({
  imports: [ProjectsModule, RequirementsModule, StoriesModule, TasksModule],
  controllers: [AiController],
  providers: [
    AiConfig,
    AiContextService,
    AiProvider,
    AiAnalysisService,
    AiAnalysisWorker,
    AiPlanningService,
    AiScenariosService,
  ],
})
export class AiModule {}
