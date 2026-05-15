# Scorecard v1.4 — super-PAC IE inclusion + continuous PAC gradient + percent display

## Why

The corporate-PAC marker in v1.3 only counts **direct contributions to the legislator's candidate committee**. Citizens United (2010) shifted the dominant route for corporate political spending to **independent expenditures (IE)** — super PACs that buy ads supporting or attacking candidates. A legislator can show "5% direct corporate PAC" on their committee filings while a corporate super PAC drops $50M in ads on their behalf. v1.3 calls that legislator "clean"; voters reading our scorecard get an incomplete picture.

Separately, v1.3 scores the corporate-PAC marker as binary `±1` at the 5% threshold. A legislator at 0.97% corporate gets the same +1 as one at 4.99%. The threshold is also a cliff: 5.01% loses the credit entirely. Both deserve more granular treatment.

Finally, raw signed integer scores (`+21`) don't communicate well to non-specialist readers. "How good is +21?" requires reading other legislators' scores for context. Anchored-absolute percent display (`+72%`) gives a stable interpretable number.

v1.4 fixes all three.

## Goals

1. **IE-aware corporate ratio.** The corporate-money signal counts both direct PAC contributions AND super-PAC support spending (FOR the legislator + AGAINST their opponents).
2. **Continuous PAC gradient.** The PAC marker scores anywhere from +2 (real zero) to −3 (corporate-dominated), not binary.
3. **Anchored-percent display.** Legislator scores render as a `-100%` to `+100%` percent of an anchored absolute scale, with raw score still visible for transparency.
4. **Disclosure of attacks.** Corporate IE spending AGAINST a legislator is shown on the PAC scoreboard as context but does **not** count toward their score (race-competitiveness drives attack spending; rewarding it is gameable).

## Non-goals

- Per-plank standalone scoreboards. Future.
- Re-introducing "Primary" / "GOP alt" badges. Future.
- Sponsor-tier refinements (committee-importance weighting etc.). Future.
- Real-time / daily IE ingest cron. v1.4 ships with manual recompute; daily-cron is a v1.5 follow-up.
- Per-IE-spender drill-down ("which super PACs spent for this senator"). v1.4 aggregates only; granular per-filing data ingested but no UI surface for it in this version.
- A compare-two-legislators view.

---

## Methodology change — v1.3 → v1.4

### The combined corporate-money ratio

The corporate-PAC marker on Plank 1 currently uses:

```
corporatePacAmount / totalReceipts
```

Under v1.4, it becomes:

```
(corporatePacAmount + corporateIeSupportAmount + corporateIeAgainstOpponentAmount)
─────────────────────────────────────────────────────────────────────────────────
(totalReceipts + corporateIeSupportAmount + corporateIeAgainstOpponentAmount)
```

The `corporateIeAgainstSelfAmount` (attacks on this legislator) is **disclosed in the table but NOT in the formula**.

### Opponent linkage — definition of "opponent" (B+C)

For each legislator, "opponent" includes:

- **B (completed cycles):** every candidate who ran for the same seat in the same election cycle as this legislator, including both primary challengers AND general-election opponents. Sourced from FEC candidates-list endpoint + Cal-Access Candidacy data.
- **C (active cycle):** every candidate who has filed paperwork to run for this legislator's seat in the next election. Tagged `DECLARED_PENDING` until the election happens; converted to WON/LOST after results.

Each cycle's corporate-IE-against-opponent count rolls into that cycle's `PacMoneyData` row.

### Continuous PAC gradient

The PAC marker score is a continuous function of the combined ratio:

| Combined ratio | Marker score |
| -------------- | ------------ |
| 0.00           | +2.0         |
| 0.05           | +1.0         |
| 0.15           | 0.0          |
| 0.35           | -1.0         |
| 0.65           | -2.0         |
| 0.85+          | -3.0         |

Linear interpolation between anchors. Clamped at endpoints. New column `MarkerAchievement.achievementScore` (nullable Decimal) stores the continuous value for PAC achievements; null for non-PAC achievements (where the v1.3 integer weight table still applies).

### Anchored-percent display

After the first v1.4 production compute, the script computes the **95th percentile** of positive raw scores and the **5th percentile** of negative raw scores. These become `positiveAnchor` / `negativeAnchor` in a new `ScoreCalibration` row keyed on `methodologyVersion = 'v1.4'`. Anchors are frozen for the life of v1.4.

Display formula:

```
percent = rawScore >= 0
  ? clamp(rawScore / positiveAnchor * 100, 0, 100)
  : clamp(rawScore / abs(negativeAnchor) * 100, -100, 0)
```

The asymmetric anchor handles the methodology's natural asymmetry (max possible raw is much higher than min, since most achievements are positive markers).

---

## Data model

### `PacMoneyData` — extend (additive)

Add four nullable Decimal columns (default 0 in queries):

| Column                             | Meaning                                                                      | Counts toward score   |
| ---------------------------------- | ---------------------------------------------------------------------------- | --------------------- |
| `corporateIeSupportAmount`         | Corporate IE spent FOR this legislator                                       | Yes                   |
| `corporateIeAgainstOpponentAmount` | Corporate IE spent AGAINST any of this legislator's same-cycle opponents     | Yes                   |
| `corporateIeAgainstSelfAmount`     | Corporate IE spent AGAINST this legislator                                   | **No** — display only |
| `combinedCorporateRatio`           | Cached v1.4 ratio (the four above + direct over the same with totalReceipts) | n/a (display cache)   |

Existing fields (`corporatePacAmount`, `totalReceipts`, `corporatePacPercentage`) unchanged — `corporatePacPercentage` remains the v1.3 reading for audit; `combinedCorporateRatio` is the v1.4 reading.

### `MarkerAchievement` — extend (additive)

Add `achievementScore Decimal?` — nullable, stores the continuous PAC marker score. Null for non-PAC achievements (cosponsorships, votes) where the v1.3 weight table applies. Compute and ingest scripts populate this only for PAC achievements.

### New: `RaceCandidate`

```
model RaceCandidate {
  id                   String        @id @default(cuid())
  legislator           Legislator?   @relation(...)
  legislatorId         String?       // null if challenger isn't a current sitting legislator
  cycleYear            Int           // e.g. 2026
  jurisdiction         Jurisdiction
  state                String        // 'CA', 'NY' etc.
  chamber              Chamber       // SEN, REP
  district             Int?          // null for senate
  externalCandidateId  String        // FEC candidate_id ('S4LA00065') or Cal-Access filer_id
  candidateName        String
  outcome              RaceOutcome

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([cycleYear, externalCandidateId])
  @@index([cycleYear, jurisdiction, state, chamber, district])
}

enum RaceOutcome {
  WON
  LOST_GENERAL
  LOST_PRIMARY
  DECLARED_PENDING
}
```

Opponent lookup: rows matching `cycleYear + state + chamber + district` where `legislatorId !== self`.

### New: `ScoreCalibration`

```
model ScoreCalibration {
  id                 String   @id @default(cuid())
  methodologyVersion String   @unique
  positiveAnchor     Decimal  @db.Decimal(8, 2)
  negativeAnchor     Decimal  @db.Decimal(8, 2)
  computedAt         DateTime @default(now())
  computedFromCount  Int      // legislators contributing to this calibration
}
```

Written once per methodology version by the compute script.

### `CommitteeClassification` — already exists, expand coverage

Existing table works for both PAC and IE committees. Add a one-time bulk-seed from OpenSecrets' federal PAC classification CSV → upserts thousands of rows mapping committee_id → CORPORATE / LABOR / etc.

---

## Data ingestion

### 1. OpenSecrets classification bulk seed — `scripts/ingest-opensecrets-classifications.ts` (new)

One-time script. Fetches OpenSecrets' public CSV mapping FEC committee_ids to their Business / Labor / Single-Issue classifications. Upserts into `CommitteeClassification` for federal IE committees. Their `Business` → our `CORPORATE`; `Labor` → `LABOR`; etc. Logs unmappable rows.

Run once pre-v1.4 deploy. Re-runnable if OpenSecrets updates their CSV.

### 2. RaceCandidate ingest — `scripts/ingest-race-candidates.ts` (new)

Pulls candidate-master records from FEC + Cal-Access:

- **FEC:** `api.open.fec.gov/v1/candidates/?office=H|S&state=...&district=...&cycle=...` → upsert as `RaceCandidate`. Outcome derived from FEC's `election_year` + general-election results endpoint.
- **CA:** parse Cal-Access Candidacy data already on disk in CCDC bulk → same shape, jurisdiction='CA'.

Run order: pull for the most recent 2-3 cycles + the next election cycle (`DECLARED_PENDING`).

### 3. Federal Schedule E — extend `scripts/ingest-fec.ts`

The existing script pulls FEC candidate-summary data. Extend to also pull Schedule E filings:

For each legislator + cycle:

1. Pull `api.open.fec.gov/v1/schedules/schedule_e/?candidate_id=<legislator's FEC id>` — IE filings targeting this candidate.
2. Pull same for each `RaceCandidate` row matching this legislator's cycle/state/chamber/district where `externalCandidateId !== self`.
3. For each filing: look up `committee_id` in `CommitteeClassification`. If `CORPORATE` or `TRADE_ASSOCIATION` → count.
4. Bucket by `support_oppose_indicator + target`:

   - Target = self, S → `corporateIeSupportAmount` += amount
   - Target = self, O → `corporateIeAgainstSelfAmount` += amount (display only)
   - Target = opponent, O → `corporateIeAgainstOpponentAmount` += amount

5. Write/upsert into `PacMoneyData`. Compute `combinedCorporateRatio` and store.

Unclassified spender committees: don't count toward corporate buckets (conservative attribution, consistent with v1.3).

### 4. CA Form 496 — extend `src/lib/scorecard/calaccess-parser.ts` and `scripts/ingest-cal-access.ts`

Add a second pass to the existing parser. The CCDC bulk zip already on disk includes Form 496 (Late Independent Expenditure Reports). Likely tables: `s496_cd.csv` and joining via `expn_cd.csv`. Schema verification required during implementation.

Same logic as federal: spender classification → support/oppose indicator → target candidate → bucket. CA committees encountered → manual classification of top spenders into `CommitteeClassification`.

### 5. Compute pipeline — extend `scripts/compute-scores.ts`

After all ingest runs:

1. Pull `PacMoneyData` rows; for each PAC achievement, call `pacScoreFromRatio(combinedCorporateRatio)` to get the continuous score.
2. Write `MarkerAchievement.achievementScore` for PAC achievements; `actionTaken` is `ACTED_FOR` if `achievementScore >= 0` else `ACTED_AGAINST`.
3. `scoreLegislator` reads `achievementScore` for PAC achievements; uses v1.3 integer weight table for all other achievement types.
4. `METHODOLOGY_VERSION` bumps to `'v1.4'`.
5. After the full compute, **compute the 95th and 5th percentile of resulting raw scores** across all published legislators and upsert `ScoreCalibration` for `methodologyVersion='v1.4'`.

### Run order (one-time post-deploy)

```
1. npm run scorecard:ingest-opensecrets-classifications
2. npm run scorecard:ingest-race-candidates -- --cycles=2022,2024,2026,2028
3. npm run scorecard:ingest-fec                          # now also pulls Schedule E
4. npm run scorecard:ingest-ca-pac -- --ccdc-dir=./data/calaccess/raw  # now also parses Form 496
5. npm run scorecard:compute -- --auto-verify --publish  # writes v1.4 rows + ScoreCalibration
```

After initial seed, sync includes IE going forward.

---

## UI surfaces

### PAC scoreboard — `/scorecard/pac`

Column order (Source + Cycle hidden; cycle noted in page header):

```
Rank | Legislator | Party · State | Direct corp $ | Corp IE Supporting (BOLD) | Corp IE vs opponents | Corp IE attacking (muted italic) | % Corporate Donations (PRIMARY BOLD) | Total receipts
```

- **`% Corporate Donations`** is the renamed `combinedCorporateRatio` (was "Combined %"). Primary column for sort (default: ascending = refusers at top).
- **`Corp IE Supporting`** rendered prominently — larger numeric or accent color — because it's the most direct corporate-aligned-money signal.
- **`Corp IE attacking`** rendered small + muted italic — it's disclosure, not score.
- Header gets a footnote: _"2025-2026 cycle · sources: FEC + Cal-Access via CCDC"_.

Mobile: collapse the three IE columns into one expandable "$X corporate IE — tap for breakdown" row.

### Scorecard index — `/scorecard`

Each legislator row's score cell shows the anchored-percent as the primary number with raw alongside:

Before: `+21`
After: `**+72%**` (bold, color-graded) · `+21 raw` (small mono)

Color ramp: green-positive, neutral-gray-zero, red-negative; linear interpolation by percent.

Sort: by percent descending (highest first).

### Legislator detail — `/scorecard/[id]`

Hero number changes:

- v1.3: `+21` (signed integer)
- v1.4: `+72%` (huge serif, color-graded) with `raw +21 · 18 for · 3 against` underneath

Per-plank cards keep raw plank scores (`+5` etc.) — plank-level percents are noisy with small denominators.

Per-marker rows: PAC marker shows continuous score with the underlying ratio: `+1.6 · 8.3% combined corporate donations`. Non-PAC markers unchanged.

### Methodology page — `docs/scorecard-methodology.md` rewrite

Single source of truth. v1.3 rewrite stays the structural template; v1.4 rewrite extends with:

- **Updated weight table** — add the continuous PAC gradient anchors.
- **Combined corporate-money formula** — written out with IE inclusion explained.
- **Opponent linkage** — B+C explained in plain English. "Past general-election opponents + currently-declared challengers."
- **Anchored percent display** — explain percentile-derived anchors + that they're frozen per methodology version + re-anchor on next version bump.
- **What's NOT in the formula** — corporate IE attacking you. One paragraph: "Competitive races draw attack spending regardless of policy; rewarding it would game the methodology."
- **Version table** — add v1.4 row dated 2026-05-14.

Doc grows from ~127 to ~180 lines.

---

## Validation

### Unit tests

- `pacScoreFromRatio(ratio: number): number`:
  - Anchor coverage: 0.0 → +2, 0.05 → +1, 0.15 → 0, 0.35 → -1, 0.65 → -2, 0.85 → -3, 1.0 → -3.
  - Interpolation: 0.025 → +1.5, 0.50 → -1.5, etc.
  - Clamp behavior at endpoints.
- Combined ratio math: known inputs → known output, including edge case where `totalReceipts + IE = 0` (return 0 ratio to avoid divide-by-zero).
- Anchored percent: `rawToPercent(raw, posAnchor, negAnchor)` — boundary clamps + asymmetric anchors.

### Integration

- `ScoreCalibration` row populated by the compute script after the first run.
- `RaceCandidate` lookup test: given a known race (e.g., 2024 OH-Sen Sherrod Brown vs Bernie Moreno), querying for opponents of Brown's `legislatorId` in cycle 2024 returns Moreno.
- End-to-end: a fixture legislator with known direct PAC + known IE inputs produces the expected `combinedCorporateRatio` and percent.

### Preview spot-check (5 legislators)

| Legislator                        | Why                                                | Expected behavior                                                                    |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Sherrod Brown** (former OH-Sen) | Heavy corporate IE _against_ him in 2024           | Direct corp % low; IE attacking him massive but score-neutral; total moves modestly  |
| **John Tester** (former MT-Sen)   | Lost 2024 with heavy corporate IE both directions  | Combined % should jump — corporate IE attacking his opponent (Sheehy) counts FOR him |
| **AOC**                           | Heavy corporate-IE attacks historically            | Direct corp % near zero; IE attacking her column should be prominent (display-only)  |
| **John Kennedy** (R-LA)           | Heavy direct corp PAC + presumably corp IE-aligned | Combined % rises above the 0.97% direct number once IE included                      |
| **Ash Kalra** (CA Assembly)       | CalCare author, low direct corp PAC                | CA pipeline sanity + Cal-Access Form 496 parser sanity                               |

### Rollback

If v1.4 recompute produces obviously wrong scores: `git revert <merge-sha>`. v1.3 rows persist in DB; read filter reverts to `methodologyVersion='v1.3'` and the display reverts to integer scores. `RaceCandidate`, `CommitteeClassification`, and `ScoreCalibration` rows persist as harmless data; safe to leave or clean up later.

---

## Scope guard

This is bigger than v1.3 was. Realistically ~15-20 implementation tasks:

- Schema: 3 additions (PacMoneyData cols, RaceCandidate, ScoreCalibration) + 1 column add (MarkerAchievement.achievementScore)
- Ingest: 3 new scripts (opensecrets seed, race candidates, Schedule E extension) + 1 parser extension (Cal-Access Form 496)
- Scoring engine: continuous PAC gradient function, percent display function
- UI: PAC table column changes, scorecard list percent display, legislator detail hero, methodology page rewrite
- Validation: ~12 unit tests + 5-legislator spot-check on preview

Plan-writing step (next) will decompose into bite-sized tasks; this spec is the contract.

If during implementation we discover a task that meaningfully expands scope (e.g., the Cal-Access Form 496 parser turns out to need its own model migrations), we pause and decide together: defer to v1.5, or expand v1.4 scope.

---

## Out of scope (intentional)

- Real-time / daily IE ingest cron. v1.4 ships with manual recompute trigger.
- Per-IE-spender drill-down UI. Data is captured at the aggregate level; per-filing data lives in raw FEC/Cal-Access for the data-curious but no dedicated page in v1.4.
- Compare-two-legislators view.
- "Primary" / "GOP alt" badge re-introduction.
- Sponsor-tier weighting refinements.
- Per-plank standalone scoreboard pages.
- React 19 migration.
