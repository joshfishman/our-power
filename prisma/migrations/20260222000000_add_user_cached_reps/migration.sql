-- AlterTable
ALTER TABLE "User" ADD COLUMN "cachedRepresentatives" JSONB;
ALTER TABLE "User" ADD COLUMN "repsLookedUpAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "repsLookupAddress" TEXT;
