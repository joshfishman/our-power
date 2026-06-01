-- v1.9.2 — covering indices for PAC Score hot paths
--
-- PacContribution holds 1.7M+ rows after the v1.9.0 LEADERSHIP_PASS_THROUGH
-- ingest. Every public scorecard page load (index + legislator detail) fans
-- out queries that join PacContribution to PacClassification on
-- (donorCommitteeId, class) and aggregate by (legislatorId, kind). Without
-- covering indices, Postgres falls back to a 22k-row hash build for the
-- classification side and seq-scans large partitions of PacContribution on
-- the legislator side. These indices match the GROUP BY + WHERE shape in
-- src/lib/scorecard/queries.ts:getPacScoresByLegislatorV171 and
-- getLegislatorMoneyTrail directly.

-- v1.9.2 perf: covers the per-(legislator, kind) aggregates that drive
-- PAC Score. Matches the GROUP BY hot path in getPacScoresByLegislatorV171's
-- CASE-on-kind SUMs. INCLUDE (amount) lets the planner serve index-only
-- scans for the SUM(amount) aggregates without chasing the heap — critical
-- at 1.7M+ row scale. (Note: Prisma's @@index syntax doesn't model INCLUDE
-- columns, so the @@index in schema.prisma names only the key columns. The
-- INCLUDE is set here in raw SQL; a future `prisma db push` will not strip
-- it because the index already exists with the same name.)
CREATE INDEX "PacContribution_legislatorId_kind_donorCommitteeId_idx" ON "PacContribution"("legislatorId", "kind", "donorCommitteeId") INCLUDE ("amount");

-- v1.9.2 perf: covering index for the PacContribution→PacClassification
-- join. committeeId is already the PK (so this is technically redundant for
-- equality lookups) but the composite lets Postgres serve (committeeId,
-- class) reads index-only and avoids touching the heap on the join side.
CREATE INDEX "PacClassification_committeeId_class_idx" ON "PacClassification"("committeeId", "class");

-- v1.9.2 perf: cycle-year filters on individual-money + DIME profile read
-- paths (cross-cycle dashboards / methodology recompute jobs).
CREATE INDEX "LegislatorIndividualMoney_cycleYear_idx" ON "LegislatorIndividualMoney"("cycleYear");
CREATE INDEX "LegislatorDimeProfile_cycleYear_idx" ON "LegislatorDimeProfile"("cycleYear");
