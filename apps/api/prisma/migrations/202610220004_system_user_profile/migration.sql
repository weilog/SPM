-- Existing accounts keep an unknown historical creation date; no invented timestamps.
ALTER TABLE "User" ADD COLUMN "displayName" VARCHAR(30);
ALTER TABLE "User" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
