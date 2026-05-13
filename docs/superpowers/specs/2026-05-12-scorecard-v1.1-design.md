# Scorecard v1.1 — ±1 scoring, legislator avatars, achievement-aware bill page

## Why

The current scorecard shows every plank as `score / 5` even when only one bill backs the plank. Most legislators land at 0/5 — not because they opposed the platform, but because no measurable signal exists yet. The display reads as failure when it should read "not yet measured."

CalCare (AB-1900) has 25 cosponsor achievements but zero floor votes, so its bill page falls through to a "No recorded floor vote yet" placeholder while AB-2200 shows a tidy two-row vote list. The two pages look fundamentally different despite carrying comparable information.

This spec replaces the 5-point matrix with a ±1 sum, drops fixed denominators, and renders cosponsorship achievements alongside floor votes on bill pages. It also adds circular avatars where the UI previously showed name-only rows.

## Goals

1. Score reflects measured signal, not absence of signal.
2. Cosponsors and committee voters appear on bill pages with the same visual treatment as floor voters.
3. Every legislator row carries a circular avatar.

## Non-goals

- No methodology change to how achievements are _recorded_ (ACTED_FOR / ACTED_AGAINST / NO_RECORD). Sync pipelines stay untouched.
- No backfill of new bills or new marker sources. (Another contributor is expanding coverage in parallel — this spec must not race with that work.)

## Methodology change — v1.0 → v1.1

### Per marker

- `ACTED_FOR` → **+1**
- `ACTED_AGAINST` → **−1**
- `NO_RECORD` (no row, or explicit `NO_RECORD`) → contributes 0 to both numerator and denominator

### Per plank

- `plankScore = sum(+1 / −1 across markers)`
- `plankDenominator = count(markers with ACTED_FOR or ACTED_AGAINST)`
- Display: `${plankScore} / ${plankDenominator}` when denominator > 0; "Not yet measured" otherwise.

### Per legislator

- `totalScore = Σ plankScore`
- `totalDenominator = Σ plankDenominator`
- Display: `${totalScore} / ${totalDenominator}`. The hard-coded `/25` and `/20` are removed everywhere.

### PAC marker (Plank 1 corporate-PAC-refusal)

- Under 5% corporate PAC share → `ACTED_FOR` (+1) — unchanged.
- 5% or above → `ACTED_AGAINST` (−1) — was previously treated as just "not achieved" (0). Newly counts toward the negative.
- No PAC data → `NO_RECORD` (0).

### Storage

- `RepresentativeScore.score` is already `Int` and can hold negatives.
- Add `RepresentativeScore.measuredCount Int @default(0)` so the list page can render `score/measured` without a join to MarkerAchievement.
- `methodologyVersion` flips from `"v1.0"` to `"v1.1"`. The unique constraint `(legislatorId, plankId, methodologyVersion)` means v1.0 rows persist unmodified; new rows are written at v1.1. **Decision: overwrite is achieved by simply switching reads to v1.1.** The compute script can optionally purge v1.0 rows in a follow-up; not required for this spec.
- Public reads (`getLegislatorList`, `findLegislatorByAnyId`, `computePublishedTotal`) filter to `methodologyVersion: 'v1.1'`.

## UI changes

### A. Avatars

- Add a `<LegislatorAvatar>` component (40px round) with a tinted-initials fallback for null `photoUrl`.
- Insert at:
  - `src/app/(unprotected)/scorecard/page.tsx` — the legislator list `<li>` rows.
  - `src/app/(unprotected)/scorecard/bills/[id]/page.tsx` — each `VoteSection` row.
- Replace the existing rectangular 120×150 photo on the per-legislator detail page with the same circular 96px avatar for consistency (a small but deliberate uniformity choice).

### B. Per-plank display

- `[id]/page.tsx` plank header: render `${plankScore}/${plankDenominator}` or "Not yet measured" when `measuredCount === 0`.
- Drop the `isLowCoverage` opacity hack — denominator now makes coverage visible directly.

### C. Bill page — "Where they stand" panel

- Refactor the `VoteSection` rendering on `[id]/page.tsx` to read from a unified source per bill:
  - For each `MarkerAchievement` row tied to the bill's marker, surface the legislator with a position label and a `+1` or `−1` chip.
  - Continue to include `BillVote` rows for legislators who voted in a recorded roll call; merge with achievements via `legislatorId` so floor-vote-only and cosponsor-only and combined records all render in the same panel.
  - Group order: For (green +1) → Against (red −1). `NO_RECORD` rows are not rendered, per the "no zero" rule.
- The "No recorded floor vote yet" placeholder is shown only when both achievements _and_ votes are empty.
- Result: CalCare AB-1900 shows the cosponsor list; AB-2200 shows cosponsors + 2 committee voters; federal bills with floor votes show the same layout.

## Files touched

- `src/lib/scorecard/scoring.ts` — replace `scorePlank` / `scoreLegislator`. Export new signature with `measuredCount`.
- `src/lib/scorecard/queries.ts` — filter scores by `methodologyVersion: 'v1.1'`; include `measuredCount` in selects; extend bill-page query to also pull marker achievements.
- `scripts/compute-scores.ts` — write v1.1 rows including `measuredCount`. Honor existing `--changes-only`, `--publish`, `--auto-verify` flags.
- `prisma/schema.prisma` — add `measuredCount Int @default(0)` to `RepresentativeScore`.
- New migration via `prisma migrate dev --name representative_score_measured_count`.
- `src/components/scorecard/LegislatorAvatar.tsx` (new).
- `src/app/(unprotected)/scorecard/page.tsx` — render avatars; drop `/25` `/20` hardcoding; show new format.
- `src/app/(unprotected)/scorecard/[id]/page.tsx` — new per-plank display + circular avatar.
- `src/app/(unprotected)/scorecard/bills/[id]/page.tsx` — unified achievements+votes panel.

## Concurrency note

Another contributor is actively adding bills/achievements. Constraints:

- No `truncate` or destructive deletes on scorecard tables.
- All score writes via `prisma.representativeScore.upsert` keyed on `(legislatorId, plankId, methodologyVersion)`.
- Schema migration adds a nullable / defaulted column; safe to apply alongside ongoing data writes.
- After other Claude finishes ingest, `npm run scorecard:compute -- --publish` re-derives every score.

## Test plan

- Unit tests against `scoring.ts`:
  - Plank with 0 ACTED_FOR + 0 ACTED_AGAINST → `{score: 0, measuredCount: 0}`.
  - Plank with 2 ACTED_FOR + 1 ACTED_AGAINST → `{score: 1, measuredCount: 3}`.
  - Plank with NO_RECORD on every marker → `{score: 0, measuredCount: 0}`.
- Manual: load `/scorecard?jurisdiction=CA`, confirm scores like `4/7` not `0/20`.
- Manual: load `/scorecard/bills/calcare`, confirm cosponsor names appear under "Voted Yes / Cosponsored."
- Manual: load a federal bill with a floor vote, confirm layout unchanged.

## Out of scope / future

- Splitting the +1 weight by sponsor tier (Author vs Cosponsor) — current spec treats all ACTED_FOR equally.
- Per-marker confidence weighting.
- Public archival page for v1.0 historical scores.
