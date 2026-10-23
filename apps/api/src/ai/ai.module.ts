import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  IsIn,
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
class RequestKey {
  @IsOptional() @IsUUID() requestKey?: string;
}
class AnalysisRequest extends RequestKey {
  @IsIn(ANALYSIS_KINDS) kind!: AnalysisKind;
  @IsOptional() @IsInt() @Min(1) taskId?: number;
  @IsOptional() @IsString() @Length(1, 100) stageId?: string;
}
class HistoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 10;
  @IsOptional() @IsUUID() cursor?: string;
}
@Controller("projects/:projectId/ai")
export class AiController {
  constructor(
    private readonly service: AiAnalysisService,
    private readonly projects: ProjectsService,
    private readonly config: AiConfig,
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
    return this.service.history(a, p, q.limit, q.cursor);
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
}
@Module({
  imports: [ProjectsModule],
  controllers: [AiController],
  providers: [
    AiConfig,
    AiContextService,
    AiProvider,
    AiAnalysisService,
    AiAnalysisWorker,
  ],
})
export class AiModule {}
