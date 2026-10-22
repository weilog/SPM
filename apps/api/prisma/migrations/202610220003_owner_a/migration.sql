BEGIN;
-- CreateTable
CREATE TABLE "PlanStage" (
    "id" VARCHAR(100) NOT NULL,
    "projectId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000) NOT NULL DEFAULT '',
    "start" VARCHAR(10) NOT NULL,
    "end" VARCHAR(10) NOT NULL,
    "ownerUserId" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlanStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanGoal" (
    "id" VARCHAR(100) NOT NULL,
    "projectId" INTEGER NOT NULL,
    "stageId" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlanGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" VARCHAR(100) NOT NULL,
    "number" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "stageId" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(12) NOT NULL DEFAULT 'item',
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000) NOT NULL DEFAULT '',
    "start" VARCHAR(10) NOT NULL,
    "end" VARCHAR(10) NOT NULL,
    "ownerUserId" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'TODO',
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "kind" VARCHAR(10) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "mime" VARCHAR(100) NOT NULL DEFAULT '',
    "size" INTEGER NOT NULL DEFAULT 0,
    "content" BYTEA,
    "ownerUserId" INTEGER NOT NULL,
    "ownerName" VARCHAR(80) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanStage_projectId_id_key" ON "PlanStage"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PlanItem_number_key" ON "PlanItem"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PlanItem_projectId_id_key" ON "PlanItem"("projectId", "id");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_parentId_idx" ON "ProjectDocument"("projectId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDocument_projectId_id_key" ON "ProjectDocument"("projectId", "id");

-- AddForeignKey
ALTER TABLE "TaskPlanReference" ADD CONSTRAINT "TaskPlanReference_projectId_planId_fkey" FOREIGN KEY ("projectId", "planId") REFERENCES "PlanItem"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PlanStage" ADD CONSTRAINT "PlanStage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanStage" ADD CONSTRAINT "PlanStage_projectId_ownerUserId_fkey" FOREIGN KEY ("projectId", "ownerUserId") REFERENCES "ProjectMember"("projectId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PlanGoal" ADD CONSTRAINT "PlanGoal_projectId_stageId_fkey" FOREIGN KEY ("projectId", "stageId") REFERENCES "PlanStage"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_projectId_stageId_fkey" FOREIGN KEY ("projectId", "stageId") REFERENCES "PlanStage"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_projectId_ownerUserId_fkey" FOREIGN KEY ("projectId", "ownerUserId") REFERENCES "ProjectMember"("projectId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_parentId_fkey" FOREIGN KEY ("projectId", "parentId") REFERENCES "ProjectDocument"("projectId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_state_check" CHECK (status IN ('TODO','IN_PROGRESS','DONE','PAUSED'));
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_kind_check" CHECK (kind IN ('item','milestone'));
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_dates_check" CHECK ("start" <= "end");
ALTER TABLE "PlanStage" ADD CONSTRAINT "PlanStage_dates_check" CHECK ("start" <= "end");
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_kind_check" CHECK (kind IN ('FOLDER','FILE'));
COMMIT;
