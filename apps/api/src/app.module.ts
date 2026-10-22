import "./environment";
import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DbModule } from "./db/db.module";
import { Public, SecurityGuard } from "./common/security";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { ProjectsModule } from "./projects/projects.module";
import { TasksModule } from "./tasks/tasks.module";
import { RequirementsModule } from "./requirements/requirements.module";
import { StoriesModule } from "./stories/stories.module";
import { UmlModule } from "./uml/uml.module";
import { DocumentsModule } from "./documents/documents.module";
import { WorkbenchModule } from "./workbench/workbench.module";
@Controller("health")
class HealthController {
  @Public() @Get() health() {
    return { ok: true };
  }
}
@Module({
  imports: [
    DbModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    TasksModule,
    RequirementsModule,
    StoriesModule,
    UmlModule,
    WorkbenchModule,
    DocumentsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SecurityGuard }],
})
export class AppModule {}
