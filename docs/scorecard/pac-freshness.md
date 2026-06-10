# PAC data freshness — provisional cycles vs. track record

_Scope: federal PAC Score only. CA uses a separate latest-complete-cycle path
(`getLegislatorPacScore`) and is not covered here. Source of truth:
`src/lib/scorecard/queries.ts`._

## The problem: a ratio built from two feeds that update on different clocks

A legislator's per-cycle PAC money ratio is:

```
cycle ratio = counted-against money  ÷  (receipts + IE_SUPPORT + beneficiary IE)
```

The two halves of that fraction come from **different FEC feeds**:

- the **numerator** (counted-against contributions) is assembled from the
  contributions / committee-transaction feeds, and
- the **denominator** is anchored on `PacMoneyData.totalReceipts`, the
  principal committee's reported total receipts.

Those feeds publish on different cadences. Mid-cycle — before an election has
happened and filings have settled — the contributions feed routinely runs
**ahead** of the receipts feed. When that happens the numerator can exceed the
denominator and the ratio overshoots 100%, which is impossible for a real share
of money. The ratio for that cycle is simply garbage: it is "this cycle so
far," measured against a receipts snapshot that hasn't caught up yet.

### The Graham example

Lindsey Graham's **2026** cycle counted **$1.66M** of counts-against money
against only **$573K** of reported receipts → a raw ratio of **~290%**. Read
naively, that cycle would say "Graham takes 290% of his money from corporate
PACs," tanking his score. His **2020** cycle, by contrast, is a closed,
complete cycle: ratio ~0.251, a real track record.

The fix is to recognize the 2026 cycle as **incomplete** and keep it out of the
score, so the headline rests on the complete-cycle track record (Graham PAC
Score = 75, driven by 2020) rather than on a mid-cycle artifact.

## The named guard: `isCycleComplete`

The staleness test is centralized in one predicate,
`isCycleComplete({ countsAgainst, denominator })` in `queries.ts`. A cycle is
**complete** (its ratio is trustworthy and feeds the score) when:

- its `denominator` (receipts + IE_SUPPORT + beneficiary IE) is positive, **and**
- `countsAgainst <= denominator` — i.e. the raw ratio does **not** exceed 1.0.

A cycle is **incomplete** (dropped from the score) when **either**:

1. **Receipts are $0 while real counted money is on record.** The ratio would
   then be driven entirely by independent expenditures, not the campaign's own
   fundraising. (This is the long-standing v1.7.7 no-receipts guard.)
2. **The raw, unclamped ratio exceeds 1.0.** A share of money cannot exceed
   100%, so a ratio above 1 means the contributions feed has run ahead of the
   receipts feed for an in-progress cycle — the Graham 2026 case.

`isCycleComplete` is the **single source of truth** for the per-cycle
`included` flag. Both federal surfaces consume it through
`computePerCyclePacScore`:

- `getLegislatorMoneyTrail` (legislator detail page), and
- `getPacScoresByLegislatorV171` (index / bulk).

Because both paths run the same predicate, they drop the same cycles and can
never disagree on a score. The PAC Score is `(1 − mean(ratio of the INCLUDED
cycles)) × 100`. If **every** cycle is incomplete, the engine falls back to the
single most-recent cycle's ratio clamped to `[0, 1]`, so a legislator still
gets a score rather than `null`.

This guard is a **clarity refactor + surfacing**, not a scoring change: it
produces identical results to the prior drop-incomplete behavior. Spot-checks
held steady across the change — Graham = 75, Sanders = 100, Cassidy = 61,
Ernst = 59.

## Surfaced freshness metadata (on `PacMoneyTrail`)

`getLegislatorMoneyTrail` now exposes freshness primitives **derived from
existing fields** (no schema change), all computed from the same per-cycle
`included` flags that drive the score:

| Field | Meaning |
| --- | --- |
| `dataAsOf` | `max(PacMoneyData.updatedAt)` across the legislator's rows — the freshness stamp of the underlying receipts/contributions snapshot. `null` if no PAC rows. |
| `cyclesTotal` | Cycles that produced a usable ratio (`perCycle.length`). |
| `cyclesIncluded` | Cycles that fed the score mean (`isCycleComplete` = true). |
| `cyclesDroppedIncomplete` | `cyclesTotal − cyclesIncluded`; cycles excluded as incomplete (receipts feed lagging). |
| `perCycle[].included` | Per-cycle flag (unchanged) — which specific cycles counted. |

Graham, for example, now reports `cyclesTotal = 2, cyclesIncluded = 1,
cyclesDroppedIncomplete = 1` with the 2026 row flagged `included: false`.

## How a UI would label provisional vs. track record

The headline PAC Score does **not** change — it remains the
complete-cycle-driven number. The metadata lets a surface label it honestly:

- **`cyclesDroppedIncomplete === 0`** → the score reflects only closed cycles.
  Render plainly as the **track record**, e.g. "PAC Score 100 — track record
  across 3 complete cycles."
- **`cyclesDroppedIncomplete > 0`** → at least one in-progress cycle was set
  aside. Show the headline as the **track record (complete cycles)** and add a
  provisional note for the current cycle:
  - "Track record: 75 (1 complete cycle)."
  - "This cycle so far: provisional — receipts still being reported, as of
    `dataAsOf`." Pull the live-but-unreliable figure from the `perCycle` row
    where `included === false` if the surface wants to show it, but never let
    it move the headline.
- **`pacScore === null`** → no usable PAC data; render the existing "no PAC
  data" badge.
- Race cards can use `dataAsOf` to time-stamp the whole money block ("PAC data
  as of June 2026") and `cyclesDroppedIncomplete` to decide whether to show a
  "provisional this cycle" chip next to the score.
