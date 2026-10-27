-- CreateTable
CREATE TABLE "AiAnalysisRun" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "requestedById" INTEGER,
    "kind" VARCHAR(24) NOT NULL,
    "scope" JSONB NOT NULL,
    "requestKey" VARCHAR(100) NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    "sourceHash" TEXT,
    "sourceDate" VARCHAR(10),
    "rulesVersion" VARCHAR(40) NOT NULL,
    "modelState" VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUESTED',
    "modelInfo" JSONB,
    "errorCode" VARCHAR(40),
    "retryOf" TEXT,
    "retryDepth" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "modelAttemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRiskFinding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "ruleId" VARCHAR(48) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "dimensions" JSONB NOT NULL,
    "fact" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "inference" JSONB,

    CONSTRAINT "AiRiskFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAnalysisRun_status_createdAt_idx" ON "AiAnalysisRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiAnalysisRun_projectId_createdAt_id_idx" ON "AiAnalysisRun"("projectId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AiAnalysisRun_projectId_modelAttemptedAt_idx" ON "AiAnalysisRun"("projectId", "modelAttemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysisRun_projectId_requestedById_requestKey_key" ON "AiAnalysisRun"("projectId", "requestedById", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiRiskFinding_runId_eventKey_key" ON "AiRiskFinding"("runId", "eventKey");

-- AddForeignKey
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRiskFinding" ADD CONSTRAINT "AiRiskFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New tables only: no business rows, columns or requirement depth rules change.
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_status_check"
CHECK ("status" IN ('QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED'));
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_kind_check"
CHECK ("kind" IN ('HEALTH','COVERAGE','TASK','PLAN','MEMBER','CROSS_VIEW'));
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_retry_check" CHECK ("retryDepth" >= 0);
ALTER TABLE "AiRiskFinding" ADD CONSTRAINT "AiRiskFinding_severity_check"
CHECK ("severity" IN ('INFO','LOW','MEDIUM','HIGH'));
