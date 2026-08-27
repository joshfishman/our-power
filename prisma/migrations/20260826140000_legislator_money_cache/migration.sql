-- Legislator.moneyCache — the frozen per-legislator money aggregates.
--
-- Publish-then-freeze: everything the public pages derive from PacContribution
-- (PAC money trail, CA money trail, top donors, opposing PACs, outside-money
-- summary) is precomputed into this column by scripts/freeze-money-cache.ts.
--
-- PacContribution is ~1.8M rows and ~646MB — by far the largest table, and the
-- reason the database is over its size limit. It is an INGEST-TIME input, not a
-- runtime dependency: once this column is populated the itemized rows can be
-- dropped and re-ingested only when the data is refreshed and re-frozen.
--
-- Additive and nullable. Every read path falls back to the live query when this
-- is null, so nothing changes until the freeze script runs.

ALTER TABLE "Legislator" ADD COLUMN "moneyCache" JSONB;
