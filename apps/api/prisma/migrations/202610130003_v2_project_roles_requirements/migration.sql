-- Additive V2 upgrade: preserve all users, projects, memberships and tasks.
CREATE TYPE "ProjectRole" AS ENUM ('MANAGER', 'DEVELOPER', 'TESTER');
ALTER TABLE "ProjectMember" ADD COLUMN "role" "ProjectRole" NOT NULL DEFAULT 'DEVELOPER';
UPDATE "ProjectMember" AS member SET "role" = 'MANAGER'
FROM "Project" AS project
WHERE member."projectId" = project."id" AND member."userId" = project."managerId";
-- Repair a missing owner membership without duplicating existing rows.
INSERT INTO "ProjectMember" ("projectId", "userId", "role")
SELECT "id", "managerId", 'MANAGER'::"ProjectRole" FROM "Project"
ON CONFLICT ("projectId", "userId") DO NOTHING;

CREATE TABLE "Requirement" (
  "id" SERIAL PRIMARY KEY,
  "projectId" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(10000) NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "requirement_title_not_blank" CHECK (length(btrim("title")) > 0)
);
CREATE INDEX "Requirement_projectId_idx" ON "Requirement"("projectId");
