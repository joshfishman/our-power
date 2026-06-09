# CA PAC ratio — MONEY-bucket parity (v0.9)

Status: **code parity shipped; data refresh BLOCKED — requires re-downloading the CCDC Cal-Access bulk files** (see "What's needed to refresh the data").

## Background

The federal PAC score counts the full MONEY bucket — `COUNTS_AGAINST_CLASSES` in
`src/lib/scorecard/queries.ts`: CORPORATE, DARK_MONEY, FOREIGN_POLICY,
TRADE_ASSOCIATION, PARTY, LEADERSHIP, IDEOLOGICAL, CONDUIT, UNKNOWN
(conservative attribution: unclassified money counts against the legislator).
The PEOPLE bucket (LABOR, grassroots ACTIVIST) never counts.

California legislators do not flow through that code path. Their PAC score
comes from `PacMoneyData.corporatePacPercentage` (and `combinedCorporateRatio`,
which is **null for all 238 CA rows** — so `corporatePacPercentage` is the
effective ratio), precomputed at ingest time by
`scripts/ingest-cal-access.ts` → `src/lib/scorecard/calaccess-parser.ts`.

## Old vs new definition

| | Old (pre-v0.9) | New (v0.9 parity) |
|---|---|---|
| Direct committee receipts (`ENTITY_CD='COM'` rows in `rcpt_cd.csv`) counted against | CORPORATE, TRADE_ASSOCIATION only (`isCorporateForRatio`) | CORPORATE, TRADE_ASSOCIATION, PARTY, IDEOLOGICAL, **UNCLASSIFIED** (`CA_COUNTS_AGAINST_CLASSES`) |
| Unclassified committees | Did **not** count ("conservative attribution" ran in the legislator's favor) | **Count** — mirrors federal UNKNOWN; conservative attribution now runs in the legislator's disfavor |
| LABOR | Never counts | Never counts (PEOPLE bucket) |
| CANDIDATE (inter-candidate transfers) | Never counts | Never counts — documented limitation, see below |
| IE spender gate (Form 461 Sched. E pass) | `CommitteeClassification.category IN (CORPORATE, TRADE_ASSOCIATION)` | `CommitteeClassification.motivationClass = 'MONEY'` (CORPORATE + TRADE_ASSOCIATION + PARTY + IDEOLOGICAL, minus manual PEOPLE overrides) |

Code changed:

- `src/lib/scorecard/calaccess-parser.ts` — new exported
  `CA_COUNTS_AGAINST_CLASSES` set; `isCorporateForRatio()` (name kept for
  compatibility) now returns true for the full MONEY bucket including
  UNCLASSIFIED.
- `scripts/ingest-cal-access.ts` — IE pass now gates spenders on
  `motivationClass: 'MONEY'` instead of the category pair.

Nothing in `src/lib/scorecard/queries.ts`, `scoring.ts`, or
`scripts/compute-scores.ts` was touched — the CA read path is unchanged; only
what gets baked into `PacMoneyData.corporatePacAmount` / `corporatePacPercentage`
at the next ingest changes.

## Why the data could NOT be refreshed in place

The new definition needs per-contributor class breakdowns, and neither survives
anywhere we can reach:

1. **No DB rows.** `PacContribution` has **0 rows** for CA legislators (the
   table is federal-only; verified 2026-06-09). The CA ingest only ever
   persisted the pre-aggregated `PacMoneyData` row per (legislator, cycle):
   `corporatePacAmount` (computed under the OLD definition), `totalReceipts`,
   `corporatePacPercentage`, and the three IE buckets. The parser's in-memory
   `contributorBreakdown` map was never written to the DB, so PARTY /
   IDEOLOGICAL / UNCLASSIFIED amounts per legislator are unrecoverable from
   what's stored.
2. **No on-disk source.** The raw Cal-Access CSVs lived at
   `data/calaccess/raw/` (per the v1.4 plan docs), which is gitignored
   (`/data/*`) and has been deleted. A filesystem-wide search (Spotlight +
   `find`) found no copy of `rcpt_cd.csv` / `cvr_campaign_disclosure_cd.csv` /
   `expn_cd.csv` / `filername_cd.csv` on this machine.

Consequently `scripts/recompute-ca-pac-ratios.ts` was **not** written — there
is nothing to recompute from. The current 238 `CAL_ACCESS_CCDC` rows
(120 distinct legislators, 2024 + 2026 cycles) still carry OLD-definition
ratios until a re-ingest.

## What's needed to refresh the data

Re-download the raw CAL-ACCESS exports published by CCDC (California Civic
Data Coalition) / Big Local News:

- Source: <https://calaccess.californiacivicdata.org/downloads/latest/>
  (raw CAL-ACCESS tables; also mirrored via Big Local News).
- Files needed, placed in `data/calaccess/raw/`:
  - `rcpt_cd.csv` (~3+ GB — Form 460 receipts; the PAC-ratio numerator/denominator source)
  - `cvr_campaign_disclosure_cd.csv` (filing cover pages — FILING_ID → candidate/filer joins)
  - `expn_cd.csv` (expenditures — `FORM_TYPE='F461P5'` IE rows)
  - `filername_cd.csv` (filer roster — only needed to re-run committee classifications)

Then run, in order:

```bash
# (only if classifications need refreshing; 29,695 CA rows already in DB)
npm run scorecard:ingest-ca-classifications -- --filername=data/calaccess/raw/filername_cd.csv

# re-ingest with the new MONEY-bucket counting (dry-run first)
npm run scorecard:ingest-ca-pac -- --ccdc-dir=./data/calaccess/raw --dry-run
npm run scorecard:ingest-ca-pac -- --ccdc-dir=./data/calaccess/raw

# final recompute (human-run, per workflow)
npm run scorecard:compute -- --auto-verify --publish --jurisdiction=CA
```

Expected direction of movement: every CA ratio can only stay equal or go **up**
(strictly more classes count against), so corporate-PAC-refusal achievements
can only be lost, never gained, by this change. Spot-check high-profile
legislators (e.g. Rivas, Wiener, Gallagher, Grayson — the largest receipts)
before publishing.

## Limitations (documented, not invented)

- **No DARK_MONEY / CONDUIT / LEADERSHIP / FOREIGN_POLICY equivalents in the
  CA pipeline.** Cal-Access disclosure doesn't map onto those federal FEC
  classes; the CA classifier has no signal for them. UNCLASSIFIED counting
  against (federal-UNKNOWN parity) is the conservative stand-in.
- **CANDIDATE committees excluded.** Inter-candidate transfers are the closest
  CA analog to federal LEADERSHIP pass-throughs, but the CA classification
  pipeline deliberately skips candidate-controlled committees
  (`scripts/ingest-ca-classifications.ts`), and there is no Cal-Access
  pass-through apportionment data to attribute them correctly. Known
  undercount relative to federal semantics.
- **No JFC / pass-through concept** in the CA path; only direct receipts and
  the Form 461 Schedule E IE buckets exist.
- **Classification at receipt time is name-heuristic** (`classifyCommittee`
  on `CTRIB_NAML`), not a join against `CommitteeClassification` — so manual
  PEOPLE/MONEY overrides in the DB affect the IE spender gate but not the
  direct-receipts ratio. Future work: key receipts by committee FILER_ID and
  prefer DB classifications over the heuristic.
- **`combinedCorporateRatio` remains null for CA** — `corporatePacPercentage`
  is the effective ratio on the read path
  (`combinedCorporateRatio ?? corporatePacPercentage` in queries.ts and
  compute-scores.ts) until an IE-combining step is added for CA.
