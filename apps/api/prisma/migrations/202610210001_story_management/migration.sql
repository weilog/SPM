-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "ProductGoal" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Epic" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "goalId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStory" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "epicId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000) NOT NULL DEFAULT '',
    "acceptanceCriteria" VARCHAR(10000) NOT NULL DEFAULT '',
    "status" "StoryStatus" NOT NULL DEFAULT 'TODO',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryRequirement" (
    "projectId" INTEGER NOT NULL,
    "storyId" INTEGER NOT NULL,
    "requirementId" INTEGER NOT NULL,

    CONSTRAINT "StoryRequirement_pkey" PRIMARY KEY ("projectId","storyId","requirementId")
);

-- CreateTable
CREATE TABLE "StoryTask" (
    "projectId" INTEGER NOT NULL,
    "storyId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,

    CONSTRAINT "StoryTask_pkey" PRIMARY KEY ("projectId","storyId","taskId")
);

-- CreateIndex
CREATE INDEX "ProductGoal_projectId_sortOrder_idx" ON "ProductGoal"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductGoal_projectId_id_key" ON "ProductGoal"("projectId", "id");

-- CreateIndex
CREATE INDEX "Epic_projectId_goalId_sortOrder_idx" ON "Epic"("projectId", "goalId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Epic_projectId_id_key" ON "Epic"("projectId", "id");

-- CreateIndex
CREATE INDEX "UserStory_projectId_epicId_sortOrder_idx" ON "UserStory"("projectId", "epicId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "UserStory_projectId_id_key" ON "UserStory"("projectId", "id");

-- CreateIndex
CREATE INDEX "StoryRequirement_projectId_requirementId_idx" ON "StoryRequirement"("projectId", "requirementId");

-- CreateIndex
CREATE INDEX "StoryTask_projectId_taskId_idx" ON "StoryTask"("projectId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_id_key" ON "Task"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_projectId_id_key" ON "Requirement"("projectId", "id");

-- AddForeignKey
ALTER TABLE "ProductGoal" ADD CONSTRAINT "ProductGoal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_projectId_goalId_fkey" FOREIGN KEY ("projectId", "goalId") REFERENCES "ProductGoal"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStory" ADD CONSTRAINT "UserStory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStory" ADD CONSTRAINT "UserStory_projectId_epicId_fkey" FOREIGN KEY ("projectId", "epicId") REFERENCES "Epic"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryRequirement" ADD CONSTRAINT "StoryRequirement_projectId_storyId_fkey" FOREIGN KEY ("projectId", "storyId") REFERENCES "UserStory"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryRequirement" ADD CONSTRAINT "StoryRequirement_projectId_requirementId_fkey" FOREIGN KEY ("projectId", "requirementId") REFERENCES "Requirement"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryTask" ADD CONSTRAINT "StoryTask_projectId_storyId_fkey" FOREIGN KEY ("projectId", "storyId") REFERENCES "UserStory"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryTask" ADD CONSTRAINT "StoryTask_projectId_taskId_fkey" FOREIGN KEY ("projectId", "taskId") REFERENCES "Task"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
