-- Additive only: no existing business rows or use-case node kinds are changed.
CREATE TABLE "UmlSequence" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "projectId" INTEGER NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" VARCHAR(10000) NOT NULL DEFAULT '',
  "participants" JSONB NOT NULL DEFAULT '[]',
  "messages" JSONB NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "UmlSequence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UmlSequence_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "UmlSequence_content_check" CHECK (length(btrim("name")) > 0 AND jsonb_typeof("participants") = 'array' AND jsonb_typeof("messages") = 'array')
);
CREATE UNIQUE INDEX "UmlSequence_projectId_id_key" ON "UmlSequence"("projectId", "id");
CREATE TABLE "UmlSequenceStory" (
  "projectId" INTEGER NOT NULL, "sequenceId" INTEGER NOT NULL, "storyId" INTEGER NOT NULL,
  CONSTRAINT "UmlSequenceStory_pkey" PRIMARY KEY ("projectId", "sequenceId", "storyId"),
  CONSTRAINT "UmlSequenceStory_projectId_sequenceId_fkey" FOREIGN KEY ("projectId", "sequenceId") REFERENCES "UmlSequence"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UmlSequenceStory_projectId_storyId_fkey" FOREIGN KEY ("projectId", "storyId") REFERENCES "UserStory"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "UmlSequenceUseCase" (
  "projectId" INTEGER NOT NULL, "sequenceId" INTEGER NOT NULL, "nodeId" INTEGER NOT NULL,
  CONSTRAINT "UmlSequenceUseCase_pkey" PRIMARY KEY ("projectId", "sequenceId", "nodeId"),
  CONSTRAINT "UmlSequenceUseCase_projectId_sequenceId_fkey" FOREIGN KEY ("projectId", "sequenceId") REFERENCES "UmlSequence"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UmlSequenceUseCase_projectId_nodeId_fkey" FOREIGN KEY ("projectId", "nodeId") REFERENCES "UmlNode"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
