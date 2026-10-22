BEGIN;
ALTER TABLE "User" ADD COLUMN "email" VARCHAR(254);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "PasswordReset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "passwordHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PasswordReset_userId_createdAt_idx" ON "PasswordReset"("userId", "createdAt");
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");
COMMIT;
