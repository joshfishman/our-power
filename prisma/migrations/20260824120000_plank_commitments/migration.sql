-- Plank.commitments — the plank's promises to the public, in display order.
--
-- These are the plain-language VALUES behind the rubric ("Full disclosure of
-- dark money"), as distinct from Marker rows, which are the measurable acts
-- used to score a legislator ("Cosponsored DISCLOSE Act"). The issues index
-- renders commitments so a reader sees what a plank MEANS before seeing how it
-- is scored.
--
-- Named `commitments` rather than `values` because VALUES is a reserved word in
-- Postgres and would need quoting in every raw query.
--
-- Additive and non-destructive: defaults to an empty array, so existing rows
-- are valid immediately and no score or page changes as a result. Content is
-- populated from the seed files by scripts/backfill-plank-commitments.ts (or by
-- any subsequent `prisma:seed-scorecard` run).

ALTER TABLE "Plank"
  ADD COLUMN "commitments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
