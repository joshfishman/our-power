-- Phase 6 — admin verification UI
--
-- Adds the schema behind human verification of MarkerAchievement evidence,
-- retiring the `--auto-verify` / `pac-engine` stand-ins as the only provenance
-- signal we have.
--
-- Design notes:
--
--  * `MarkerAchievement.verifiedAt` alone cannot answer "did a human look at
--    this?" — the ingest engines stamp it too. `verifierUserId` is set ONLY by
--    a signed-in human, which makes the trust tier derivable:
--        GREEN  = verifiedAt IS NOT NULL AND verifierUserId IS NOT NULL
--        YELLOW = verifiedAt IS NOT NULL AND verifierUserId IS NULL   (machine)
--        RED    = verifiedAt IS NULL AND reviewStatus <> 'REJECTED'
--
--  * `reviewStatus` exists so a REJECTED claim leaves the pending queue instead
--    of silently re-queueing forever. It is NOT redundant with `verifiedAt`:
--    rejected rows are both unverified (excluded from scoring) and not pending.
--
--  * Backfill is deliberately conservative. Existing machine-verified rows keep
--    their `verifiedAt` and land in PENDING/YELLOW so the public scorecard does
--    not go dark while the queue drains (Option B in the Phase 6 design spec).
--    No score changes as a result of this migration.
--
--  * `MarkerAchievementReview` is an append-only audit trail. The mutable
--    columns on MarkerAchievement hold only the latest decision; this table is
--    what backs the methodology's "traces to a named human" promise.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "PlatformRole" AS ENUM ('MEMBER', 'SCORECARD_VERIFIER', 'SCORECARD_ADMIN');

CREATE TYPE "AchievementReviewStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TYPE "AchievementReviewAction" AS ENUM ('VERIFY', 'REJECT', 'REVOKE');

-- ---------------------------------------------------------------------------
-- User.platformRole
-- ---------------------------------------------------------------------------

ALTER TABLE "User"
  ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'MEMBER';

-- ---------------------------------------------------------------------------
-- MarkerAchievement verification columns
-- ---------------------------------------------------------------------------

ALTER TABLE "MarkerAchievement"
  ADD COLUMN "reviewStatus"    "AchievementReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "verifierUserId"  TEXT,
  ADD COLUMN "verifiedFromUrl" TEXT,
  ADD COLUMN "reviewNote"      TEXT,
  ADD COLUMN "rejectedAt"      TIMESTAMP(3);

ALTER TABLE "MarkerAchievement"
  ADD CONSTRAINT "MarkerAchievement_verifierUserId_fkey"
  FOREIGN KEY ("verifierUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MarkerAchievement_reviewStatus_idx"   ON "MarkerAchievement"("reviewStatus");
CREATE INDEX "MarkerAchievement_verifierUserId_idx" ON "MarkerAchievement"("verifierUserId");

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE "MarkerAchievementReview" (
  "id"             TEXT NOT NULL,
  "achievementId"  TEXT NOT NULL,
  "reviewerUserId" TEXT,
  "reviewerEmail"  TEXT NOT NULL,
  "action"         "AchievementReviewAction" NOT NULL,
  "previousStatus" "AchievementReviewStatus" NOT NULL,
  "citationUrl"    TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarkerAchievementReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarkerAchievementReview_achievementId_idx"  ON "MarkerAchievementReview"("achievementId");
CREATE INDEX "MarkerAchievementReview_reviewerUserId_idx" ON "MarkerAchievementReview"("reviewerUserId");
CREATE INDEX "MarkerAchievementReview_createdAt_idx"      ON "MarkerAchievementReview"("createdAt");

ALTER TABLE "MarkerAchievementReview"
  ADD CONSTRAINT "MarkerAchievementReview_achievementId_fkey"
  FOREIGN KEY ("achievementId") REFERENCES "MarkerAchievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarkerAchievementReview"
  ADD CONSTRAINT "MarkerAchievementReview_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
