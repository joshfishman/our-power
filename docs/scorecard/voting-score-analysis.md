# Voting Score — diagnosis and redesign options

> Analysis only. No scoring logic was changed in producing this document.
> Repo state: methodology stamp `v1.9.1` (`src/lib/scorecard/scoring.ts:28`),
> `RepresentativeScore.score` typed `Int` (`prisma/schema.prisma:845`).

## TL;DR

The number labelled **"Voting"** on every public surface is **not** produced by
the documented two-score / aligned-over-total ratio model in `queries.ts`. It is
produced by the **signed-sum engine** (`scoring.ts` + `scripts/compute-scores.ts`),
which writes one signed integer per plank into `RepresentativeScore.score`, and
then collapsed to a single number by `computePublishedTotal`
(`queries.ts:131`). The ratio model's voting tally
(`getLegislatorBillBreakdown`, `queries.ts:952`) runs on the detail page but its
output is **display-only** — it never feeds a score. The `−100..+100` scaled view
and its calibration anchors are **dead code** in production.

---

## Live data flow — system-by-number map

Three public surfaces render scores: the index (`/scorecard`), the detail page
(`/scorecard/[id]`), the race page (`/scorecard/race/[seat]`), plus the JSON API
(`/api/scorecard/legislators/[id]`). All four pull the voting number the same way.

| Displayed number | Where rendered | Function that produces it | Underlying system |
| --- | --- | --- | --- |
| **(a) Headline / "Average"** | `[id]/page.tsx:127` `ScoreCell`/`HeroCell` | `computeTwoScoreAverage(pacScore, votingScore)` (`queries.ts:171`) = `round((pac+voting)/2)` | mean of (b) and the PAC ratio |
| **(b) "Voting" score** | index `page.tsx:236`, detail `[id]/page.tsx:78`, race `:122`, API `route.ts:25` | `computePublishedTotal(legislator.scores)` (`queries.ts:131`) | **Signed-sum engine.** `scores` = `RepresentativeScore` rows (`getLegislatorList`, `queries.ts:77`; `findLegislatorByAnyId:96`), written by `compute-scores.ts` |
| **(c) Per-plank number** | `[id]/page.tsx:254` `ScoreNumber` | `plankScore.score` straight from the `RepresentativeScore` row | **Signed-sum engine** (`scorePlank`, `scoring.ts:163`) |
| **(c′) "N aligned of M bills" line** | `[id]/page.tsx:650` `BillBreakdownList` | inline count over `getLegislatorBillBreakdown` rows (`queries.ts:952`) | **Ratio model — display only.** Not a score; never rolled up |
| **(d) −100..+100 scaled view** | *not rendered anywhere* | `rawToPercent` (`scoring.ts:153`) | **Dead.** Only caller is `scoring.test.ts`; `getScoreCalibration` is fetched then `void`-ed at `page.tsx:71` |
| **PAC score (federal)** | index `:237`, detail `:126` | `getPacScoresByLegislatorV171` / `getLegislatorMoneyTrail.pacScore` (`queries.ts:313`, `:448`) | Ratio model `(1 − countsAgainst/denom)×100` |
| **PAC score (CA)** | index `:94`, detail `:97` | `getPacScoresByLegislator` / `getLegislatorPacScore` (`queries.ts:182`, `:152`) | Legacy `PacMoneyData` ratio `(1 − ratio)×100` |

### Where the two systems cross / conflict

1. **The PAC plank is double-counted by construction.** `compute-scores.ts`
   computes a `corporate-pac-refusal` MarkerAchievement from `PacMoneyData`
   (`computePacAchievements`, `:77`) using the continuous gradient
   `pacScoreFromRatio` (`scoring.ts:127`, range −3..+2). That achievement lands on
   **Plank 1** and is summed into Plank 1's `RepresentativeScore.score` — i.e. into
   the **Voting** number (b/c). Separately, the headline also averages in a
   **full PAC Score** computed by an entirely different engine
   (`getPacScoresByLegislatorV171`, the per-class `PacContribution` ratio). The same
   corporate-money signal is therefore baked into Plank 1 of the voting record *and*
   surfaced again as its own headline score. The methodology (v1.7 §"Score 1",
   doc lines 9-19) explicitly says PAC was *promoted out of* Plank 1 — but the sum
   engine never stopped folding it in.

2. **The plank score shown and the bills shown are computed by different
   engines.** (c) is the signed sum of marker achievements; (c′) is the ratio
   model's aligned/total over the roll-call + cosponsor universe. They draw from
   overlapping-but-different bill sets and combine evidence differently, so the
   "42% Plank 2" number and the "3 aligned of 11 bills" line under it have no
   arithmetic relationship. A reader cannot reconcile them.

3. **`computePublishedTotal` silently switches formula per-legislator** (see
   Defect 1) — sum for some, mean for others.

---

## The voting tally dissected (`getLegislatorBillBreakdown`, `queries.ts:952-1173`)

This is the documented model. **Important: it is never scored** — it produces
`BillBreakdownRow[]` per plank for the UI list only. Documented here because the
redesign options below would promote it to the actual scorer, and because it is
what the methodology doc *claims* is live.

- **Universe / denominator.** Two sources unioned, deduped by `billType|billNumber`:
  - **Roll-call universe** (`:966`): `RollCallVote` rows with `isScorable=true`,
    `alignedPosition != null`, `plankNumbers` non-empty, filtered to the leg's
    chamber. So `total_bills` for a plank = count of distinct scorable bills tagged
    to that plank in the leg's chamber, **plus** marker bills (below). There is no
    explicit denominator variable — the UI computes `breakdown.length` at render
    time (`[id]/page.tsx:650`). Confidence-<0.5 exclusion happens upstream via
    `isScorable`, per doc lines 53.
  - **Marker universe** (`:992`, `:1100`): every `Marker.bills` for the
    jurisdiction, cross-chamber, mapped from storage bill-type via
    `STORAGE_TYPE_MAP` (`:1006`), deduped against roll-call rows by key (`:1118`).
- **Chamber gating** (`:957-965`): SEN→`SENATE`, REP→`HOUSE`, CA SEN→`CA_SENATE`,
  CA REP→`CA_ASSEMBLY`. Matches doc lines 36. **But marker bills are emitted
  cross-chamber** (`:1100` has no chamber filter) — a House member can be credited
  aligned on a Senate marker bill via cosponsorship. Minor divergence from strict
  gating.
- **Multiple roll calls per bill → dedup + position choice** (`:1041-1063`):
  bills aggregated into `BillAgg`. `votedAligned` is set true if the leg voted the
  aligned way on **any** roll call (`:1060` `if (isAligned) existing.votedAligned = true`)
  — i.e. **most-supportive position wins**, matching doc line 34. `legPosition`
  keeps the first non-null position seen (`:1061`), used only for the ✓/✗ glyph.
- **Cosponsorship vs roll-call** (`:1082-1083`): `isAligned = votedAligned || cosponsored`.
  Cosponsoring = full alignment, matching doc lines 27-32. There is **no weight
  asymmetry here** — in the ratio model a cosponsor and an aligned vote both yield
  `isAligned=true`, worth exactly one aligned bill. (The +3/+2/+1 sponsor-tier
  asymmetry lives only in the *sum* engine, `weightForAchievement`, `scoring.ts:93`.)
- **Absences / abstentions / PRESENT** (`:1044-1045`): `legPos` is the raw position
  string; `isAligned` is true only if `legPos === alignedPosition`. So
  `NOT_VOTING`, `EXCUSED`, `PRESENT`, and `NO` all yield `isAligned=false` →
  **counted as not-aligned (0), not penalized below 0.** Matches doc line 38.
- **NO_RECORD bills** (no position row, `v.positions[0]` undefined → `legPos=null`):
  `isAligned = false` unless cosponsored. They **remain in the denominator**
  (`breakdown.length` counts them). This is the documented "neither cosponsored nor
  voted → not aligned" rule (doc line 38) — proportional dilution is correct *in
  this model*. (Contrast the sum engine, Defect 5.)
- **Roll-up into a plank percentage:** **does not exist in code.** The doc
  (lines 23, 44) says `Voting Score = aligned_bills / total_bills × 100` and the
  total is the mean of per-plank percents. **No function computes this.** The UI
  shows the raw "N of M" count but the *scored* plank number comes from the sum
  engine. This is the central defect: the documented denominator/numerator are
  computed for display and then thrown away.

---

## Code-vs-doc divergences

| # | Methodology doc says | Code does | Location |
| --- | --- | --- | --- |
| D1 | "Voting Score = aligned_bills / total_bills × 100", total = mean of per-plank percents (lines 23, 44) | Voting = `computePublishedTotal` over **signed marker-point sums**; no aligned/total ratio is ever scored | `queries.ts:131`, `compute-scores.ts:309` |
| D2 | PAC Score "promoted to its own headline score… separate from voting record" (lines 9-19) | PAC continuous score (−3..+2) is **also** summed into Plank 1's voting score | `compute-scores.ts:138-164`, `scoring.ts:87` |
| D3 | Cosponsorship and votes carry "same signal weight" (line 32) | True in ratio model; **false in the live sum engine** — cosponsor AUTHOR=+3, vote=+1 | `scoring.ts:93-98` |
| D4 | "Scores as percentages… +100% = top legislator, frozen per version" (lines 215-228) | Scaled −100..+100 view is **not rendered**; `rawToPercent` unused outside tests; anchors fetched then `void`-ed | `page.tsx:71`, `scoring.ts:153` |
| D5 | Anchors "computed once per methodology version… frozen" (line 225); `scoring.ts:143-147` says "95th/5th percentile, frozen for the lifetime of that version" | `compute-scores.ts` **recomputes min/max anchors every run** (`:414-415` uses `totals[0]`/`totals[last]`, not percentiles) | `compute-scores.ts:392-433` vs `scoring.ts:143` |
| D6 | Not-aligned (incl. absence) counts as 0 (line 38) | Sum engine scores every recorded non-yes vote as **−1** (active penalty), per `scoring.ts:74-80` | `scoring.ts:91-98` |
| D7 | `getScoreCalibration` docstring claims default `{positiveAnchor:25, negativeAnchor:-10}` and "95th/5th percentiles" | No caller uses the default; anchors written are min/max not percentiles | `queries.ts:1376-1383` |
| D8 | API returns truthful methodology version (v1.8.10 changelog) | API `route.ts:25` returns `computePublishedTotal` (sum) as `total` while labelling page v1.9.1 two-score | `route.ts` |

---

## Defects (severity-ranked)

### SEV-1 — The live "Voting" score is a signed sum, not the documented rate (volume bias)
- **Where:** `compute-scores.ts:309` (`scoreLegislator` → signed sum), surfaced via
  `computePublishedTotal` (`queries.ts:131`).
- **Why wrong:** A legislator's voting number scales with *how many* bills touched
  them, not what *share* they supported. The sum engine's own header brags about
  this (`scoring.ts:16-19`: "+10, not 4/25"). It makes scores incomparable across
  legislators with different bill volume and across chambers.
- **Worked example:** Senator A: aligned on 12 of 12 plank-2 bills → sum `+12`.
  Senator B: aligned on 30 of 60 plank-2 bills (half!) → sum `+30 −30 = 0` if
  misaligned votes are −1, or `+30` if only aligned votes count and the rest are
  NO_RECORD. Either way B's *rate* (50%) is worse than A's (100%) but B can outscore
  A on the sum. Symptom: a prolific moderate outranks a perfect-record member.

### SEV-1 — `computePublishedTotal` switches between sum and mean per-legislator
- **Where:** `queries.ts:134` `allInPercentRange = scores.every(s => 0 ≤ s.score ≤ 100)`.
- **Why wrong:** The branch is chosen by whether *any* plank is negative or >100.
  Since plank sums are signed integers (roughly [−3,+17] per the anchor comment,
  `compute-scores.ts:411`), a legislator with one negative plank takes the **sum**
  branch; a legislator whose planks happen to all land in [0,100] takes the **mean**
  branch. Same engine, two different formulas, silently.
- **Worked example:** Leg A planks `[10, 3, 0, 5, 1]` (all in range) → mean
  `= round(19/5) = 4` → displayed "Voting **4%**". Leg B planks `[10, 3, −2, 5, 1]`
  (one negative) → sum `= 17` → displayed "Voting **17%**". A and B have nearly
  identical records; B shows 4× higher purely because one plank dipped negative.
  Symptom: tiny single-digit "percentages" next to large ones, neither a real percent.

### SEV-1 — Min/max calibration is unstable across recomputes (contradicts "frozen")
- **Where:** `compute-scores.ts:414-415` (`positiveAnchor = totals[last]`,
  `negativeAnchor = totals[0]`), overwriting the `ScoreCalibration` row **every run**
  (`upsert … update`, `:424`).
- **Why wrong:** Anchors are the single highest and single lowest legislator total.
  Adding/removing one bill, or one outlier legislator, moves an anchor and rescales
  *everyone* who would be displayed on the scaled view. Directly contradicts
  `scoring.ts:143-147` ("95th/5th percentile… frozen for the lifetime of that
  version") and doc line 225. (Mitigated only because the scaled view is currently
  dead — Defect SEV-3 — so the instability is latent, not yet visible.)
- **Worked example:** Run 1 max total = +17 (Sanders). Sanders gains one aligned
  vote → +18 on run 2. Every other legislator's scaled % silently shrinks ~6% with
  no methodology-version bump. The changelog's per-version anchor claims
  (`+19/−6`, v1.8.15) are snapshots of a moving target.

### SEV-2 — PAC signal double-counted (Plank 1 sum + separate headline)
- **Where:** `compute-scores.ts:138` writes PAC achievement onto Plank 1; the same
  legislator's headline averages a *separate* full PAC Score (`[id]/page.tsx:127`).
- **Worked example:** Leg refuses all corporate PAC money. Plank 1 sum gets `+2`
  (`pacScoreFromRatio(0)`), inflating their Voting score. The Average then also
  gives them a 100 PAC Score. The corporate-refusal is rewarded twice; the Voting
  axis is contaminated with a money signal the doc says was removed from it.

### SEV-2 — Absence/non-yes scored as −1 (active penalty) vs doc's 0
- **Where:** `scoring.ts:74-98` — every recorded non-yes (`NO, NOT_VOTING, EXCUSED,
  ABSTAINED, PRESENT`) → `actionTaken=ACTED_AGAINST` → `−1`.
- **Why wrong:** Doc line 38 treats absence as not-aligned (0), not as opposition.
  A missed vote drags a legislator *below* zero in the sum, distinct from simply not
  getting credit. Also note the ratio model (the intended one) correctly treats these
  as 0 (`queries.ts:1045`), so the two engines disagree on the same event.
- **Worked example:** Leg is hospitalized for 5 plank-3 votes. Sum engine: `−5` on
  Plank 3. Ratio model: those 5 bills are 5 not-aligned out of the denominator —
  bounded at 0% contribution, never negative. The sum engine can produce a negative
  plank that the UI then clamps to "0%" (`ScoreNumber`, `[id]/page.tsx:476`), hiding
  the penalty but not removing it from the headline sum.

### SEV-2 — Cosponsor (+3/+2/+1) vs vote (+1) asymmetry in the live engine
- **Where:** `weightForAchievement` (`scoring.ts:93-98`).
- **Why wrong:** Contradicts doc line 32 ("same signal weight"). An AUTHOR
  cosponsorship is worth 3 aligned votes in the sum. Combined with SEV-1, a member
  who authors a few bills but votes poorly can post a high Voting score.
- **Worked example:** Leg authors 2 plank-4 bills (`+3 each = +6`), votes against 4
  plank-4 bills (`−4`). Sum Plank 4 `= +2` → looks supportive. Ratio model: 2
  aligned of 6 = 33%. Opposite stories.

### SEV-3 — NO_RECORD contributes 0 to a sum → no proportional dilution
- **Where:** `scorePlank` (`scoring.ts:163-185`) only iterates achievements that
  exist; absent rows contribute nothing and are invisible to the denominator (there
  is no denominator).
- **Why wrong:** A legislator measured on 2 of 40 plank bills, both aligned, scores
  `+2` — identical to a legislator aligned on 2 of 2. Coverage is shown as a separate
  badge (`scoring.ts:22-26`, `computePlankCoverage`) but does not enter the score.
  In the ratio model NO_RECORD correctly dilutes (stays in `total_bills`).
- **Worked example:** New member with one cosponsorship → Plank 1 `+1`. Displayed
  identically to a veteran aligned on their one measured marker. Thin coverage reads
  as a real position.

### SEV-3 — Scaled −100..+100 view + anchors are dead but still documented/maintained
- **Where:** `rawToPercent` (`scoring.ts:153`) only used by `scoring.test.ts`;
  `getScoreCalibration` fetched then `void calibrationRow` (`page.tsx:71`).
- **Why it matters:** The methodology doc (lines 215-231) and `scoring.ts` comments
  describe a display that no longer ships, and `compute-scores.ts` still spends a
  full DB pass each run computing anchors nobody reads (`:392-433`). Maintenance
  burden + a public methodology that misdescribes the product.

### SEV-3 — `Int` rounding of continuous PAC float into the plank sum
- **Where:** `compute-scores.ts:352` `Math.round(row.score)` (column is `Int`,
  `schema.prisma:845`). The PAC continuous score (e.g. +1.8) is summed into Plank 1
  then the whole plank is rounded.
- **Worked example:** Leg with combined-corporate ratio 0.02 → `pacScoreFromRatio`
  ≈ +1.6. If Plank 1 also has a +1 cosponsor, plank = 2.6 → stored `3`. The 0.6 of
  PAC nuance is lost and silently merged with vote credit. Also breaks the schema
  invariant `score = forCount − againstCount` (`schema.prisma:848`) because the PAC
  float isn't ±1.

### SEV-4 — Marker bills credited cross-chamber in the breakdown
- **Where:** `getLegislatorBillBreakdown:1100` (no chamber filter on marker bills)
  vs roll-call gating at `:957`. Display-only today, but if the breakdown becomes
  the scorer (Option A), a House member could be credited for cosponsoring a
  Senate-only marker bill. Flag before promotion.

### Corrections to the original brief
- The brief framed cosponsor/vote asymmetry and absence=−1 as ratio-model issues.
  They are **sum-engine** issues (`scoring.ts`); the ratio model (`queries.ts`)
  already handles both per the doc. The real problem is that the sum engine, not the
  ratio model, is what ships.
- "PAC `(1 − counts_against/denominator)×100` ~440-470" is the *money-trail* PAC
  Score (correct and live). The PAC *folded into Plank 1* is a different code path
  (`compute-scores.ts:77-167`) using `pacScoreFromRatio`. Both exist; only the first
  is the headline PAC Score.
- The `getCalibrationAnchors` default `{25,−10}` is in a **docstring** only
  (`queries.ts:1381`); no live caller applies it.

---

## Redesign options

### Option A — Adopt the documented two-score ratio model; retire the sum engine
Make `getLegislatorBillBreakdown`'s logic the *scorer*, not just the display.

- **Formula:** per plank `p`, `pct_p = aligned_bills_p / total_bills_p × 100`;
  `VotingScore = mean_p(pct_p)` over planks with `total_bills_p > 0`. Headline
  `= mean(PAC, Voting)`.
- **Denominator:** distinct scorable bills tagged to `p` in the leg's chamber
  (roll-call ∪ marker), bill-level deduped.
- **Absences:** not-aligned (0 contribution), never negative. **Cosponsorship:**
  full alignment, equal to a vote. **Chamber gating:** enforce on marker bills too
  (fixes SEV-4). **Coverage:** report `measured/total` as a confidence badge;
  optionally suppress planks below a coverage floor instead of scoring them 0.
- **Stability:** fully stable across recomputes — a percentage of a defined
  denominator, no global anchors. Adding bills changes only the affected plank.
- **Comparability:** directly comparable across legislators and chambers (it's a
  rate). **Calibration:** none needed for display; validate sign/magnitude vs
  DW-NOMINATE.
- **Migration:** delete `scoreLegislator`/`scorePlank` sum path, write `pct` (0-100)
  into `RepresentativeScore.score`, drop `ScoreCalibration` writes, remove
  `rawToPercent`. `computePublishedTotal` becomes a plain mean (the `allInPercentRange`
  branch becomes always-true). PAC stays out of Plank 1 (delete `computePacAchievements`
  Plank-1 attribution). Recompute every legislator; bump methodology to v2.0.

### Option B — Keep weighting, but make it a *rate* with explicit denominator
For teams that want sponsor-tier emphasis to survive.

- **Formula:** per plank, `pct_p = clamp(Σ earned_weight / Σ possible_weight, 0, 1)×100`,
  where aligned vote/cosponsor earns its weight (vote 1, cosponsor 1-3) and the
  denominator is the max attainable weight over the plank's measured bills.
  Misaligned/absent earn 0 (not negative). `VotingScore = mean_p(pct_p)`.
- **Denominator:** explicit — sum of max weights over measured bills; NO_RECORD bills
  optionally included at full possible-weight to dilute (recommended) or excluded
  (coverage-only).
- **Absences:** 0. **Cosponsorship:** weighted but bounded by the denominator so it
  can't push a plank above 100 or below 0. **Gating:** same as A.
- **Stability/comparability:** stable (ratio); comparable as long as the weight
  table is fixed. **Calibration:** choose the weight table, then validate vs
  DW-NOMINATE; re-tune only on a version bump.
- **Migration:** same surface changes as A; the engine keeps a weight table but
  divides by a denominator. Bump to v2.0, recompute all.

### Option C — Two-axis rate with explicit coverage gating (recommended refinement of A)
Option A plus: don't score a plank with coverage below a floor (e.g. <3 measured
bills) — render "insufficient data" rather than a 0/low percent. Headline averages
only scored planks. Keeps thin-coverage legislators (SEV-3) from showing a confident
wrong number.

### Recommendation
**Option A, with Option C's coverage gating.** It is the model the methodology
already publishes (v1.7), it is already implemented for display so promotion is low-
risk, and it eliminates SEV-1 (volume bias), SEV-1 (sum/mean switch), SEV-2
(absence penalty), and SEV-2 (cosponsor asymmetry) in one move while keeping the
honest "X of Y bills" traceability the UI already renders. The sponsor-tier weights
(Option B) add complexity that the doc no longer claims and that DW-NOMINATE
correlation (r already −0.69 to −0.91, doc line 57) doesn't obviously need. Move PAC
fully out of Plank 1 so the two axes are independent as documented.

---

## Migration / validation plan

Per CLAUDE.md this touches **every** legislator's score, so:

1. **Branch + PR** (never on `main`). One PR: engine swap + dead-code removal
   (`rawToPercent`, `ScoreCalibration` writes, Plank-1 PAC attribution) + methodology
   doc rewrite.
2. **Methodology-version bump** to `v2.0` in `scoring.ts:28` (`METHODOLOGY_VERSION`)
   and a new `docs/scorecard-methodology.md` changelog row; old rows retained for
   audit (existing convention, doc line 249).
3. **Recompute + publish** under v2.0 (`compute-scores --auto-verify --publish` or its
   successor), writing 0-100 plank rates into `RepresentativeScore.score`.
4. **Spot-check** marquee legislators against the historical record and against the
   pre-change numbers (Sanders/Warren/Markey high; Hawley split high-PAC/low-vote;
   Scalise/McConnell low), the same set the changelog already tracks.
5. **Validate vs DW-NOMINATE** with `scripts/calibrate-vs-dw-nominate.ts` — confirm
   the new Voting axis holds Pearson r in the −0.69..−0.91 band (doc line 57). DIME
   (`data/dime_recipients_all_1979_2024.csv`) is also on disk for a CFscore cross-check
   on the PAC axis. Treat any regression below v1.x r as a blocker.
6. **Confirm UI reconciliation:** the per-plank number (c) and the "N of M bills"
   line (c′) must now be arithmetically consistent (the count *is* the score input).
7. **Remove the latent anchor instability** by deleting the `ScoreCalibration`
   recompute (`compute-scores.ts:392-433`) once the scaled view is confirmed dead.
