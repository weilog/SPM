-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "acceptanceCriteria" VARCHAR(10000) NOT NULL DEFAULT '',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AiAnalysisRun" ADD COLUMN     "output" JSONB;

-- CreateTable
CREATE TABLE "AiDraft" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "sourceRunId" TEXT,
    "baseline" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiDraft_projectId_authorId_updatedAt_idx" ON "AiDraft"("projectId", "authorId", "updatedAt");

ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_project_fk" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_author_fk" FOREIGN KEY ("authorId") REFERENCES "User"(id) ON DELETE CASCADE;
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_source_fk" FOREIGN KEY ("sourceRunId") REFERENCES "AiAnalysisRun"(id) ON DELETE SET NULL;
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_status_check" CHECK (status IN ('DRAFT','COMMITTED'));
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_revision_check" CHECK (revision>=0);

-- Preserve existing data; extend P1 types for manually requested generation only.
ALTER TABLE "AiAnalysisRun" DROP CONSTRAINT "AiAnalysisRun_kind_check";
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_kind_check" CHECK (kind IN ('HEALTH','COVERAGE','TASK','PLAN','MEMBER','CROSS_VIEW','PLANNING','TASK_SPLIT'));
