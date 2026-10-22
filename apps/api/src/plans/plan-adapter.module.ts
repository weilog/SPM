import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IsString, Length } from "class-validator";
import type { PlanSnapshot, User } from "@spm/shared";
import { Actor } from "../common/security";
import { ProjectsModule, ProjectsService } from "../projects/projects.module";

// A owns plan persistence. Bind this provider to A's service when its API is available.
// Never initialize this adapter with the HTML prototype's example arrays.
@Injectable()
export class PlanAdapter {
  async snapshot(_actor: User, _projectId: number): Promise<PlanSnapshot> {
    return {
      available: false,
      reason: "项目计划服务待对接负责人 A 的真实接口",
      stages: [],
      items: [],
    };
  }
  async validateIds(actor: User, projectId: number, ids: string[]) {
    if (!ids.length) return;
    const snapshot = await this.snapshot(actor, projectId);
    if (!snapshot.available)
      throw new ServiceUnavailableException(snapshot.reason);
    if (ids.some((id) => !snapshot.items.some((item) => item.id === id)))
      throw new ServiceUnavailableException("关联计划项无效，请刷新计划数据");
  }
}
class PlanCommandDto {
  @IsString() @Length(1, 200) title!: string;
}
@Controller("projects/:projectId/plan-adapter")
class PlanController {
  constructor(
    private readonly adapter: PlanAdapter,
    private readonly projects: ProjectsService,
  ) {}
  @Get() async snapshot(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    await this.projects.authorized(actor, p);
    return this.adapter.snapshot(actor, p);
  }
  @Post("stages") async create(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() _dto: PlanCommandDto,
  ) {
    await this.projects.authorized(actor, p, true);
    throw new ServiceUnavailableException("负责人 A 的计划写入接口待接入");
  }
  @Patch("items/:id") async update(
    @Actor() actor: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    await this.projects.authorized(actor, p, true);
    throw new ServiceUnavailableException("负责人 A 的计划写入接口待接入");
  }
}
@Module({
  imports: [ProjectsModule],
  providers: [PlanAdapter],
  exports: [PlanAdapter],
  controllers: [PlanController],
})
export class PlanAdapterModule {}
