-- v1.9.2 — ContributionKind hygiene
--
-- Two changes bundled because both touch the ContributionKind enum:
--
-- 1. Catch up schema.prisma to reality: LEADERSHIP_PASS_THROUGH was added to
--    the production DB during the v1.9.0 ingest (1.1M+ rows) but never made
--    it into schema.prisma. This migration records it formally.
--
-- 2. Drop JFC_FEED. It was reserved as a placeholder when the JFC pipeline
--    was sketched in v1.7.x but never wired up — production attributes JFC
--    dollars to the candidate directly via JFC_PASS_THROUGH. Zero rows
--    reference it (SELECT kind, COUNT(*) FROM "PacContribution" GROUP BY
--    kind returns no JFC_FEED row pre-migration).
--
-- Postgres has no DROP VALUE FROM TYPE. We rename the existing enum,
-- create a fresh one with the final value set, switch the column over, and
-- drop the old type. Safe because no rows reference JFC_FEED.

-- Step 1: add LEADERSHIP_PASS_THROUGH to the existing enum if it isn't
-- already there (idempotent — production already has it, fresh local DBs
-- created from this branch will not).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'LEADERSHIP_PASS_THROUGH'
      AND enumtypid = 'public."ContributionKind"'::regtype
  ) THEN
    ALTER TYPE "ContributionKind" ADD VALUE 'LEADERSHIP_PASS_THROUGH';
  END IF;
END$$;

-- Step 2: drop JFC_FEED via rename/recreate.
ALTER TYPE "ContributionKind" RENAME TO "ContributionKind_old";

CREATE TYPE "ContributionKind" AS ENUM (
  'DIRECT',
  'JFC_PASS_THROUGH',
  'IE_SUPPORT',
  'IE_OPPOSE',
  'IE_OPPOSE_BENEFICIARY',
  'LEADERSHIP_PASS_THROUGH'
);

ALTER TABLE "PacContribution"
  ALTER COLUMN "kind" TYPE "ContributionKind"
  USING ("kind"::text::"ContributionKind");

DROP TYPE "ContributionKind_old";
