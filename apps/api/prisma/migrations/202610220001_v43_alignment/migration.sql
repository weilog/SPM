BEGIN;
ALTER TABLE "Task" DROP CONSTRAINT "task_todo_only";
-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "priority" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" SET DATA TYPE VARCHAR(16);

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "parentId" INTEGER;

-- CreateTable
CREATE TABLE "TaskHistory" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPlanReference" (
    "projectId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,
    "planId" VARCHAR(100) NOT NULL,

    CONSTRAINT "TaskPlanReference_pkey" PRIMARY KEY ("projectId","taskId","planId")
);

-- CreateTable
CREATE TABLE "UmlDiagram" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "boundary" JSONB NOT NULL DEFAULT '{"x":260,"y":52,"width":477,"height":397,"name":"系统边界"}',
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UmlDiagram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UmlNode" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "diagramId" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000) NOT NULL DEFAULT '',
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UmlNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UmlEdge" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "diagramId" INTEGER NOT NULL,
    "fromId" INTEGER NOT NULL,
    "toId" INTEGER NOT NULL,
    "kind" VARCHAR(12) NOT NULL,

    CONSTRAINT "UmlEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UmlStory" (
    "projectId" INTEGER NOT NULL,
    "nodeId" INTEGER NOT NULL,
    "storyId" INTEGER NOT NULL,

    CONSTRAINT "UmlStory_pkey" PRIMARY KEY ("projectId","nodeId","storyId")
);

-- CreateIndex
CREATE INDEX "TaskHistory_taskId_id_idx" ON "TaskHistory"("taskId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UmlDiagram_projectId_id_key" ON "UmlDiagram"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UmlNode_projectId_diagramId_id_key" ON "UmlNode"("projectId", "diagramId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UmlNode_projectId_id_key" ON "UmlNode"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UmlEdge_diagramId_fromId_toId_kind_key" ON "UmlEdge"("diagramId", "fromId", "toId", "kind");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_parentId_fkey" FOREIGN KEY ("projectId", "parentId") REFERENCES "Requirement"("projectId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPlanReference" ADD CONSTRAINT "TaskPlanReference_projectId_taskId_fkey" FOREIGN KEY ("projectId", "taskId") REFERENCES "Task"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmlDiagram" ADD CONSTRAINT "UmlDiagram_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmlNode" ADD CONSTRAINT "UmlNode_projectId_diagramId_fkey" FOREIGN KEY ("projectId", "diagramId") REFERENCES "UmlDiagram"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmlEdge" ADD CONSTRAINT "UmlEdge_projectId_diagramId_fkey" FOREIGN KEY ("projectId", "diagramId") REFERENCES "UmlDiagram"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmlEdge" ADD CONSTRAINT "UmlEdge_projectId_diagramId_fromId_fkey" FOREIGN KEY ("projectId", "diagramId", "fromId") REFERENCES "UmlNode"("projectId", "diagramId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmlEdge" ADD CONSTRAINT "UmlEdge_projectId_diagramId_toId_fkey" FOREIGN KEY ("projectId", "diagramId", "toId") REFERENCES "UmlNode"("projectId", "diagramId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmlStory" ADD CONSTRAINT "UmlStory_projectId_nodeId_fkey" FOREIGN KEY ("projectId", "nodeId") REFERENCES "UmlNode"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmlStory" ADD CONSTRAINT "UmlStory_projectId_storyId_fkey" FOREIGN KEY ("projectId", "storyId") REFERENCES "UserStory"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT task_status_progress CHECK ((status='TODO' AND progress=0) OR (status='IN_PROGRESS' AND progress BETWEEN 0 AND 99) OR (status='DONE' AND progress=100));
ALTER TABLE "Task" ADD CONSTRAINT task_priority_valid CHECK (priority IN ('URGENT','HIGH','MEDIUM','LOW'));
ALTER TABLE "Requirement" ADD CONSTRAINT requirement_no_self CHECK ("parentId" IS DISTINCT FROM id);
ALTER TABLE "UmlNode" ADD CONSTRAINT uml_kind_valid CHECK (kind IN ('ACTOR','USE_CASE'));
ALTER TABLE "UmlEdge" ADD CONSTRAINT uml_edge_valid CHECK (kind IN ('association','include','extend') AND "fromId"<>"toId");
COMMIT;
