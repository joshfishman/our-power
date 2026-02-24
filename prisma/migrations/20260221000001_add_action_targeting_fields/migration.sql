-- Add ActionTargetMode enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActionTargetMode') THEN
    CREATE TYPE "ActionTargetMode" AS ENUM ('CIVIC', 'MANUAL', 'BOTH');
  END IF;
END $$;

-- Add ActionTargetLevel enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActionTargetLevel') THEN
    CREATE TYPE "ActionTargetLevel" AS ENUM ('LOCAL', 'STATE', 'FEDERAL');
  END IF;
END $$;

-- Add targeting columns to Action (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Action' AND column_name = 'targetMode'
  ) THEN
    ALTER TABLE "Action" ADD COLUMN "targetMode" "ActionTargetMode";
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Action' AND column_name = 'targetLevel'
  ) THEN
    ALTER TABLE "Action" ADD COLUMN "targetLevel" "ActionTargetLevel";
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Action' AND column_name = 'targetOffices'
  ) THEN
    ALTER TABLE "Action" ADD COLUMN "targetOffices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Action' AND column_name = 'manualTargets'
  ) THEN
    ALTER TABLE "Action" ADD COLUMN "manualTargets" JSONB;
  END IF;
END $$;

-- Drop dialerUrl if it still exists
ALTER TABLE "Action" DROP COLUMN IF EXISTS "dialerUrl";
