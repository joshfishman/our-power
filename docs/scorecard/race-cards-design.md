# Race Cards — design (v0.9)

> **Status: design only.** No code, schema, or DB changes accompany this doc. It specifies how the
> Common Ground scorecard should present a *political matchup* — incumbent vs. challenger(s) for an
> upcoming seat — with each candidate's scorecard, and what must be built to get there.

## 1. Why race cards are hard

The scorecard today is **retrospective and per-legislator**: every published number rests on the
methodology promise that "every point traces to a public source" and "every score is reviewed by a
human before it goes public" (`docs/scorecard-methodology.md`). That promise is only honorable on
**stable inputs**.

A race card breaks two of those assumptions at once:

1. It wants **current-cycle** money (the 2026 race) — but the current cycle's FEC/Cal-Access
   receipts are *in-progress and partial*, so any ratio built on them is unstable and routinely
   impossible (>100%). The methodology's own per-cycle scoring deliberately **drops** the
   in-progress cycle (`computePerCyclePacScore` excludes raw-ratio > 1 cycles, see §2).
2. It puts an **incumbent with a full voting record next to a challenger with none** — the two
   sides of the card are not symmetric and never can be (§3).

The design's job is to surface the current race *without* letting in-progress data contaminate the
accountability headline, and to make the incumbent/challenger asymmetry an honest, legible feature
rather than a bug.

---

## 2. The core tension: track record (stable) vs. "this cycle so far" (provisional)

### The split

Every candidate on a race card carries **two visually and semantically distinct regions**:

| Region | Question it answers | Data basis | Stability |
| --- | --- | --- | --- |
| **Track record** (headline) | "How has this person actually governed / who funded the races they've already run?" | **Complete** election cycles only | Stable; this is the publishable accountability number |
| **This cycle so far** (provisional panel) | "Who is funding the race they're running *right now*?" | The **in-progress** cycle only | Explicitly provisional, timestamped, suppressible |

These must never be averaged into one number. The track-record headline is the same two-score
average the rest of the scorecard publishes; the provisional panel is a separate, clearly-labeled
"live money watch" that sits below it.

### Exactly which fields/functions feed each

**Track record (headline) — reuse the existing publish path verbatim:**

- **Voting Record**: the published `RepresentativeScore` rows
  (`findLegislatorByAnyId` → `scores`, filtered to `publishedAt != null` and
  `methodologyVersion = CURRENT_METHODOLOGY`), per-plank mean via `computePublishedTotal`.
  This is unchanged from the legislator detail page.
- **PAC Score**: `getLegislatorMoneyTrail(legislatorId).pacScore` — the v0.9 per-cycle mean from
  `computePerCyclePacScore`. **Critically, this already excludes the in-progress cycle**: any cycle
  whose raw ratio > 1 is dropped from the mean (`included: false`), and the in-progress cycle is the
  usual cause (incomplete receipts denominator). So the existing PAC Score *is* a track-record
  number by construction.
- **Overall**: `computeTwoScoreAverage(pacScore, votingScore)` — unchanged, including the
  null-voting → null-overall rule.

The track-record region therefore requires **no new computation**. It is the legislator's existing
published scorecard, rendered in a card column.

**This cycle so far (provisional panel) — a new, separate read:**

- The in-progress cycle is `inProgressElectionCycle(new Date())` (already exported from
  `queries.ts`).
- Its money lives in the same tables — `PacMoneyData` / `PacContribution` rows where
  `cycleYear == inProgress` — and is already computed as a `PerCyclePacRatio` entry in
  `getLegislatorMoneyTrail().perCycle` (the entry with `cycle == inProgress`, typically
  `included: false`).
- The provisional panel reads **that single per-cycle row** and displays its **raw counts-against
  dollars** and **raw receipts** (the `countsAgainst` and `denominator` fields of the `PerCyclePacRatio`),
  *not* a derived ratio — see the staleness guard in §2.

The key design rule: **the same `perCycle` array already distinguishes the two regions.** Track
record = mean of `included` cycles. Provisional panel = the in-progress cycle entry (whether
included or not). We are re-presenting data the engine already separates, not recomputing it.

---

## 3. In-progress data freshness

### The failure mode

The in-progress cycle's PAC ratio is unreliable because the **denominator (total receipts) lags the
numerator (counted contributions)**. FEC/Cal-Access publish individual contribution and IE records
on a faster, more granular cadence than the candidate's summary `/totals/` receipts figure, so early
in a cycle you can have counted MONEY > reported receipts → ratio > 100%.

This is documented in the code with the real example: **Graham 2026 — $573K reported receipts vs.
$1.66M counted corporate = ~290%** (raw ratio 178% in `computePerCyclePacScore`'s comment). The
engine's response today is to *drop* that cycle from the score. The race card cannot drop it — the
whole point is to show the current race — so it needs a **freshness model** instead.

### The freshness model (three parts)

**(a) Data-as-of timestamp.** Every provisional panel shows when its money was last refreshed.
Source: `PacMoneyData.fetchedAt` for the in-progress cycle (already on the model). Display: "Money
data as of {fetchedAt}." If multiple `PacMoneyData` rows feed the cycle, use the **oldest**
`fetchedAt` among them (the panel is only as fresh as its stalest input).

**(b) Coverage / %-of-cycle indicator.** Two complementary signals, both cheap to derive:

- **Calendar coverage**: how far through the cycle we are, e.g. `(now − cycleStart) / (electionDay −
  cycleStart)`. Cheap, no data dependency. Communicates "it's early — partial by definition."
- **Receipts coverage (the real signal)**: `reported_receipts / counted_money` for the cycle. When
  this is **< 1.0**, receipts have not caught up to the contributions we've already counted — the
  denominator is incomplete. This is exactly the `ratio > 1` (i.e. `included == false`) condition
  the engine already flags. Surface it as a coverage badge, not a score.

**(c) Staleness guard — suppress the ratio.** **When receipts < counted money (equivalently raw
cycle ratio > 1, equivalently `PerCyclePacRatio.included == false`), do NOT show a percentage.**
Instead show the **raw dollar figures** ("$1.66M from concentrated wealth counted so far; $573K
total receipts reported — ratio withheld until filings catch up") plus the as-of timestamp. Only
once the in-progress cycle's receipts overtake counted money (raw ratio ≤ 1) does the panel show a
**provisional** ratio, still badged "in progress, not final."

This guard is the panel-level analogue of the engine's drop-incomplete rule: the engine refuses to
*score* an incomplete cycle; the panel refuses to *display a ratio* for one. Same threshold, same
`included` flag, different surface.

### Refresh path and cadence

- **Refresh path (already exists):** `scripts/ingest-fec-receipts-multicycle.ts` writes per-(leg,
  cycle) `totalReceipts` from FEC `/candidate/{id}/totals/` (and the bulk `/candidates/totals/`).
  Its header note that "2026 rows are left to the canonical `ingest-fec.ts`" means the **active-cycle
  receipts + IE buckets** come through `ingest-fec.ts`; the multicycle script backfills the closed
  cycles. For the active cycle, the receipts denominator is refreshed by re-running the active-cycle
  FEC ingest against `/candidate/{id}/totals/`.
- **Recommended cadence for the active cycle: weekly** during the off-season, **twice-weekly in the
  ~8 weeks before the election** (when contribution velocity peaks and the receipts lag is most
  visible). Closed/complete cycles need no refresh — they are frozen track-record inputs. This is a
  manual npm run today (Phase 7 cron is deferred); a race-card launch is the natural trigger to
  revisit scheduling the active-cycle ingest.
- Each refresh updates `fetchedAt`, which directly drives the panel's data-as-of stamp (part a) and
  can flip the staleness guard (part c) off once receipts catch up.

---

## 4. The challenger asymmetry

### Why it's structural, not fixable

A non-incumbent has **never served**, so they have **no roll-call positions and no published
`RepresentativeScore`**. Their Voting Score is `null`, and by the v0.9 overall rule
(`computeTwoScoreAverage`: `votingScore === null → null`) their **Overall is "—" (insufficient
data)**. This is the *same* rule that unranks the six non-voting delegates. A challenger and an
incumbent are therefore never comparable on the headline two-score average — and the card must say
so rather than fake a number.

### What a challenger CAN vs. CANNOT show

| | Incumbent | Challenger (never served) |
| --- | --- | --- |
| Voting Record (per-plank + headline) | ✅ full, published | ❌ null — "no voting record (never served)" |
| Overall two-score average | ✅ | ❌ "—" by the null-voting rule |
| PAC Score — track record (complete cycles) | ✅ if they've run before | ⚠️ only if they ran in a *prior, complete* cycle (e.g. a defeated former member, or a repeat challenger). A first-time candidate has **no complete cycle → no track-record PAC Score either**. |
| "This cycle so far" money panel (§2/§3) | ✅ | ✅ — **this is the challenger's primary signal** |
| Signed pledge (the Common Ground "five promises" pledge) | ✅/❌ | ✅/❌ — **the one forward-looking commitment a challenger can make** (see §4 below + the gap in §5) |

### Card layout around the asymmetry

- **Symmetric where it can be:** both columns share the same row labels (Overall, PAC, Voting,
  per-plank, This-cycle money, Pledge) so the eye compares like to like.
- **Honest blanks, not zeros:** a challenger's Voting row renders an explicit
  *"No voting record — has not served"* state, never `0%` (zero would read as "voted against
  everything," the exact mistake the delegate rule and the three-state `AchievementStatus` were built
  to avoid). Same treatment for a first-time candidate's track-record PAC row.
- **Lead with what's comparable:** the strongest apples-to-apples row for an incumbent-vs-newcomer
  card is the **"this cycle so far" money panel** (both candidates are raising money in the same
  current race) and the **pledge** (a yes/no commitment available to anyone). The card should visually
  promote those rows when one side has no voting record.
- **The pledge is the challenger's affirmative story.** Because a challenger cannot show votes, the
  signed Common Ground pledge ("I will only vote for candidates who commit to these five promises" —
  inverted here as the candidate *taking* the pledge) is the one concrete, candidate-controlled signal
  that fills the void. It needs a home in the data model (it has none today — §5).

### How non-sitting candidates are represented today

- **`Legislator` rows do double duty.** Per `ingest-current-candidates.ts`, fresh-this-cycle
  candidates are inserted as `Legislator` rows with `isActive = false` and
  `currentCandidateCycle = 2026`; sitting incumbents seeking re-election keep `isActive = true` and
  also get `currentCandidateCycle` set. So a challenger already *exists* as a `Legislator` and can
  carry PAC data and a (null) voting record.
- **`RaceCandidate`** exists but is **not a matchup model** — it's a per-cycle, per-external-id ledger
  built for IE-beneficiary attribution ("who ran against legislator X in cycle Y"). It has
  `cycleYear, jurisdiction, state, chamber, district, outcome` and an optional `legislatorId`, keyed
  `@@unique([cycleYear, externalCandidateId])`. It can *enumerate* the field in a seat-cycle, but it
  has no notion of "this incumbent vs. these challengers as a presentable card," no pledge, and links
  to `Legislator` only optionally (`onDelete: SetNull`).

---

## 5. Data-model gaps (what exists vs. net-new)

### Exists and reusable

- **Candidate identity for challengers** — `Legislator` rows (`isActive`, `currentCandidateCycle`),
  written by `ingest-current-candidates.ts`. ✅
- **Per-seat-cycle field enumeration** — `RaceCandidate` (`cycleYear, jurisdiction, state, chamber,
  district, outcome, externalCandidateId, legislatorId?`). ✅ (but see gaps)
- **Money for any candidate, any cycle** — `PacMoneyData` / `PacContribution`, the per-cycle ratio
  engine (`computePerCyclePacScore`), and `inProgressElectionCycle`. ✅
- **Outcome vocabulary** — `RaceOutcome { WON, LOST_GENERAL, LOST_PRIMARY, DECLARED_PENDING }`. ✅
- **Active-cycle refresh** — `ingest-fec.ts` (+ `ingest-fec-receipts-multicycle.ts` for closed
  cycles). ✅

### Net-new (gaps, ranked by how blocking they are)

1. **A seat / race entity (the matchup).** There is **no first-class "seat-cycle" object** that says
   "CA-Senate-2026 = incumbent X + challengers Y, Z." `RaceCandidate` is a flat per-candidate ledger
   keyed for attribution, not a grouping you can render. **Net-new:** a `Race` (or `Seat`) row keyed by
   `(jurisdiction, state, chamber, district, cycleYear)` that the candidates hang off, so a card has a
   single object to fetch. *(The `@@index([cycleYear, jurisdiction, state, chamber, district])` on
   `RaceCandidate` already proves this composite key is the natural seat identity — the index is there;
   the entity is not.)*
2. **Candidate ↔ seat ↔ opponent linkage with roles.** Today you can list everyone in a seat-cycle but
   not say *which* one is the incumbent vs. challenger, nor cleanly pair an incumbent with their
   opponent set for the card. `RaceCandidate.legislatorId` is optional and exists only for IE
   attribution. **Net-new:** an explicit `role` (INCUMBENT / CHALLENGER / OPEN_SEAT_CANDIDATE) and a
   reliable, non-null link from each card-displayed candidate to a `Legislator` row (so PAC + voting
   reads work).
3. **Pledge tracking.** **No pledge model exists anywhere in the schema** (confirmed — zero
   `Pledge`/`pledge` references in `schema.prisma`). The challenger's single affirmative signal (§4)
   has no home. **Net-new:** a `CandidatePledge` (or `Pledge`) row — candidate (`Legislator`) ↔
   pledge-version ↔ `signedAt` ↔ public evidence URL — so both incumbents and challengers can show a
   verifiable, sourced "signed the five promises" badge consistent with the methodology's
   evidence-traceability promise.

Lesser gaps: the provisional panel wants a stored or derived **receipts-coverage** signal (today it is
inferable from `PerCyclePacRatio.included` + raw figures, so this is a convenience, not a blocker);
and challenger photos/bios (`Legislator.photoUrl` exists but is sparsely populated for fresh
candidates).

---

## 6. Phased build plan

Build the freshness primitive and the provisional panel **first**, because they harden the existing
single-legislator page and ship value with zero schema change — then add the matchup model.

- **Phase 1 — Freshness primitive (no schema change).** Implement the §3 freshness model as a small
  pure helper over the data `getLegislatorMoneyTrail` already returns: take the in-progress cycle's
  `PerCyclePacRatio` (+ `PacMoneyData.fetchedAt`), and emit `{ asOf, calendarCoverage,
  receiptsCoverage, ratioSuppressed, rawCountsAgainst, rawReceipts, provisionalRatio? }`. This is the
  unit the staleness guard keys on. Land it with unit tests against the Graham-2026 case
  ($573K receipts / $1.66M counted → `ratioSuppressed = true`). **Recommended first build.**
- **Phase 2 — Provisional "this cycle so far" panel.** Render Phase 1's output on the *existing*
  legislator detail page as a separate, clearly-provisional money-watch panel below the stable
  headline. Validates the track-record/provisional split visually before any race UI exists, and
  immediately improves the current page.
- **Phase 3 — Race / seat model + linkage (the schema work).** Add the `Race`/`Seat` entity (gap 1),
  candidate roles + non-null `Legislator` linkage (gap 2), and the pledge model (gap 3). Backfill from
  `RaceCandidate` + `ingest-current-candidates.ts`. This is the methodology-adjacent, branch-+-PR,
  preview-verify change — it does not alter how any *score* is computed, but it changes what the public
  surface presents, so it follows the risky-change workflow.
- **Phase 4 — The matchup card.** Compose Phases 1–3: a card fetching one `Race`, rendering each
  candidate's stable track record (existing published scores) beside the provisional panel, with
  honest blanks for challengers' missing votes and the pledge row promoted when a side has no record.

---

## Appendix — invariants to preserve

- Never average the provisional panel into the headline. Track record stays the published
  two-score average.
- Never render a challenger's missing Voting Record as `0%` — it is "no record," the null state.
- Never display an in-progress ratio while receipts < counted money. Show raw dollars + as-of stamp.
- The PAC Score headline already drops the in-progress cycle (`computePerCyclePacScore`); do not
  "fix" that to include it for race cards — the provisional panel is where the current cycle belongs.
