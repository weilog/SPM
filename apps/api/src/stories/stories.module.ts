import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from "@nestjs/common";
import type { User } from "@spm/shared";
import { Actor } from "../common/security";
import { ProjectsModule } from "../projects/projects.module";
import {
  CreateEpicDto,
  EditEpicDto,
  CreateStoryDto,
  EditNodeDto,
  EditStoryDto,
  MoveStoryDto,
  StoryStatusDto,
  TitleDto,
} from "./stories.dto";
import { StoriesService } from "./stories.service";

@Controller("projects/:projectId")
class StoriesController {
  constructor(private readonly service: StoriesService) {}
  @Get("story-map") snapshot(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    return this.service.snapshot(a, p);
  }
  @Get("goals") async goals(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    return (await this.service.snapshot(a, p)).goals;
  }
  @Get("epics") async epics(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    return (await this.service.snapshot(a, p)).epics;
  }
  @Post("goals") goal(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: TitleDto,
  ) {
    return this.service.createGoal(a, p, d);
  }
  @Post("epics") epic(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: CreateEpicDto,
  ) {
    return this.service.createEpic(a, p, d);
  }
  @Patch("goals/:id") editGoal(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: EditNodeDto,
  ) {
    return this.service.editNode(a, p, id, "goal", d);
  }
  @Patch("epics/:id") editEpic(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: EditEpicDto,
  ) {
    return this.service.editNode(a, p, id, "epic", d);
  }
  @Get("stories") stories(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
  ) {
    return this.service.list(a, p);
  }
  @Get("stories/:id") story(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.service.detail(a, p, id);
  }
  @Post("stories") create(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Body() d: CreateStoryDto,
  ) {
    return this.service.createStory(a, p, d);
  }
  @Patch("stories/:id") edit(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: EditStoryDto,
  ) {
    return this.service.editStory(a, p, id, d);
  }
  @Patch("stories/:id/move") move(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: MoveStoryDto,
  ) {
    return this.service.move(a, p, id, d);
  }
  @Patch("stories/:id/status") status(
    @Actor() a: User,
    @Param("projectId", ParseIntPipe) p: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() d: StoryStatusDto,
  ) {
    return this.service.status(a, p, id, d);
  }
}
@Module({
  imports: [ProjectsModule],
  controllers: [StoriesController],
  providers: [StoriesService],
})
export class StoriesModule {}
