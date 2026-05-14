# Scorecard v1.3 — sponsor-tier weighting + public methodology page

## Why

Methodology v1.2 treats every recorded `ACTED_FOR` row as `+1`, regardless of whether the legislator wrote the bill or signed on as cosponsor #87 of 95. That collapses meaningful distinctions: authoring a bill is months of work; adding your name as a cosponsor is a click. The score should reflect the difference.

Separately, the scorecard's methodology has lived only in a developer-facing markdown file. Visitors who click "Methodology v1.2" in the page footer find no link. For a public-trust tool, opaque methodology is a credibility hole. Both gaps close in v1.3.

## Goals

1. Weighted scoring that distinguishes lead carriers (Author) from rank-and-file signers (Cosponsor).
2. All non-yes positions on recorded votes (NO, NOT_VOTING, EXCUSED, ABSTAINED, PRESENT) penalize the same — owning the methodological stance that "the bill needed your yes to pass, anything else denied that majority."
3. A public methodology page at `/scorecard/methodology` rendering the doc verbatim, linked from every scorecard page in three places.
4. Rewrite the methodology doc in advocacy voice so it works as a public artifact, not just engineering notes.

## Non-goals

- Re-introducing the hidden "Primary" / "GOP alt" badges. Separate task.
- Tightening EXCUSED vs NOT_VOTING semantics. We're explicitly choosing to bucket them together for clarity; refinement is future work.
- Per-plank standalone scoreboards. Future.
- Migrating off `react-markdown` if we add it. Already a standard library; no special concerns.

## Methodology change — v1.2 → v1.3

### Per-achievement weighting

| Signal                                                                    | Source                                                                            | Weight |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Author / Sponsor                                                          | `MarkerAchievement.sponsorTier = AUTHOR` or `SPONSOR`, `evidenceType = COSPONSOR` | **+3** |
| Principal Coauthor / Coauthor                                             | `sponsorTier = PRINCIPAL_COAUTHOR` or `COAUTHOR`, `evidenceType = COSPONSOR`      | **+2** |
| Cosponsor                                                                 | `sponsorTier = COSPONSOR`, `evidenceType = COSPONSOR`                             | **+1** |
| Vote YES (committee or floor)                                             | `evidenceType = VOTE`, `actionTaken = ACTED_FOR`                                  | **+1** |
| Any other recorded position (NO, NOT_VOTING, EXCUSED, ABSTAINED, PRESENT) | `evidenceType = VOTE`, `actionTaken = ACTED_AGAINST`                              | **−1** |
| PAC under 5% corporate share                                              | `evidenceType = FEC_FILING` or `CAL_ACCESS_FILING`, `actionTaken = ACTED_FOR`     | **+1** |
| PAC over 5% corporate share                                               | `evidenceType = FEC_FILING` or `CAL_ACCESS_FILING`, `actionTaken = ACTED_AGAINST` | **−1** |
| No record (no row exists)                                                 | —                                                                                 | **0**  |

**Owning the EXCUSED choice:** EXCUSED is the one recorded position where the legislator was officially absent for a sanctioned reason (medical leave, conflicting committee duty, etc.). We don't distinguish "officially excused" from "strategically absent" because LegiScan doesn't tell us why. The methodology page will say so explicitly: _"All five non-yes positions count the same: −1. Including officially-excused absences, because the bill needed your yes to pass."_ Owning the strict line beats papering over it.

### Storage

- `RepresentativeScore.score` stays `Int` (already supports both signs and arbitrary magnitudes).
- `RepresentativeScore.forCount` / `againstCount` columns no longer hold raw vote counts in a meaningful way — the score isn't `forCount − againstCount` once weighting kicks in. Decision: **rename** them to `positiveWeightSum` / `negativeWeightSum` mentally, but keep the column names because changing schema names mid-flight is high-cost and the columns are already used cosmetically (the "X for · Y against" tag on the scorecard list page). The label on that tag changes to **"+X · −Y"** with the same numbers — accurate and avoids a migration.
- `RepresentativeScore.methodologyVersion` flips from `'v1.2'` to `'v1.3'`. Old v1.2 rows persist in DB under their version key; public reads filter to v1.3. No deletion.

### Scoring engine — `src/lib/scorecard/scoring.ts`

Replace `scorePlank` to accept `MarkerAchievement[]` (with `sponsorTier`, `evidenceType`, `actionTaken`) instead of raw `forIds` / `againstIds` sets. New helper `weightForAchievement(achievement: MarkerAchievement): number` returns the signed weight per the table above. `scorePlank` sums weights across the plank's markers; markers with no achievement contribute 0.

Update `LegislatorScoreInput` interface accordingly. `scoreLegislator` adjusts to pass the full achievement list.

### Compute pipeline — `scripts/compute-scores.ts`

- Bump `METHODOLOGY_VERSION` import (sourced from `scoring.ts`).
- Pull full `MarkerAchievement` rows (with `sponsorTier`, `evidenceType`, `actionTaken`) instead of just IDs.
- Upserts run against the new `methodologyVersion = 'v1.3'` slot — won't conflict with existing v1.2 rows.

### Recomputation strategy

After the v1.3 code lands on `main` and Vercel deploys:

1. Run `npm run scorecard:compute -- --auto-verify --publish` in production (or via Vercel cron / one-off).
2. Spot-check at least 5 legislators on the deployed preview before merging — chosen for signal:
   - **Ash Kalra** (CalCare author, high sponsorship density) — expected score jump
   - **Bernie Sanders** (federal, lots of cosponsorships) — expected score jump
   - **Sharon Quirk-Silva** (high corporate-PAC %, low sponsorship) — expected lower
   - **Alexandria Ocasio-Cortez** (mix of sponsor + vote) — sanity
   - **A Republican incumbent with PAC data** (low scorecard intent) — should still score directionally consistent

## Methodology page — `/scorecard/methodology`

### Route

New server-component route at `src/app/(unprotected)/scorecard/methodology/page.tsx`. Server-side reads `docs/scorecard-methodology.md` from the filesystem at build/render time, parses with `react-markdown`, renders with Tailwind prose styling matching the scorecard palette (wheat text on navy, brick-red accent for headings).

### Content rewrite

`docs/scorecard-methodology.md` gets rewritten in advocacy voice while preserving the single-source-of-truth property:

- **Audience shift:** engineers reading it should still find the technical specifics; voters/journalists reading it should follow without prior context.
- **Voice shift:** less "we" jargon ("Provisional bill numbers", "Three-state position records"), more reader-direct framing ("What this scores", "How a legislator earns or loses points").
- **Structure shift:** lead with the +1/−1 conceptual model and weighting table FIRST (the question every reader asks). Plank descriptions follow. The v1.0 → v1.3 methodology history goes to the bottom.
- **Add:** the explicit "EXCUSED counts the same as NO" stance, in plain English.
- **Keep:** every fact about how scoring works, the PAC threshold (5%), the GOP-alt two-tier rule (Option C), the verification process.

### Markdown rendering

- Add `react-markdown` dependency. Lightweight (~10kB), maintained, no `dangerouslySetInnerHTML` required.
- Configure with `remark-gfm` (already common) for table support.
- Tailwind classes via `components={{ h1: ..., h2: ..., p: ..., ... }}` mapping override the default `react-markdown` element renderers. Match the scorecard's existing typography: serif headings, mono uppercase plank-section labels, wheat-on-navy body text.

### Discoverability (all three placements)

1. **Footer text on every scorecard page** — currently plain text "Methodology v1.3". Becomes a `<Link href="/scorecard/methodology">Methodology v1.3 →</Link>`. Applies to: `/scorecard`, `/scorecard/[id]`, `/scorecard/bills/[id]`, `/scorecard/pac`.
2. **Top nav** on `/scorecard` — add a small "Methodology" link next to the U.S. Congress / California chamber-toggle row. Styled as a tertiary chip.
3. **Intro paragraph** of `/scorecard` — append "Read the full methodology →" link to the existing copy: _"Every legislator scored against the same … each vote or cosponsorship is +1; each recorded vote-against or no-show on a recorded vote is −1. [Read the full methodology →]"_.

## Files touched

### Scoring + compute

- `src/lib/scorecard/scoring.ts` — rewrite `scorePlank` to accept achievements; add `weightForAchievement`; bump `METHODOLOGY_VERSION`.
- `scripts/compute-scores.ts` — pull full achievement rows, pass into scoring engine.

### Methodology page

- `docs/scorecard-methodology.md` — rewrite in advocacy voice.
- `src/app/(unprotected)/scorecard/methodology/page.tsx` (new) — server component, file-read + render.
- `package.json` — add `react-markdown` + `remark-gfm`.
- `src/app/(unprotected)/scorecard/page.tsx` — top nav link, intro-paragraph link, footer link.
- `src/app/(unprotected)/scorecard/[id]/page.tsx` — footer link.
- `src/app/(unprotected)/scorecard/bills/[id]/page.tsx` — footer link.
- `src/app/(unprotected)/scorecard/pac/page.tsx` — footer link.

### Validation

- `src/__tests__/scoring.test.ts` (new or extend) — 9 unit tests covering each weight bucket.

## Branch + verification

Per `CLAUDE.md` workflow rules: dedicated branch `chore/scorecard-v1.3`, PR, Vercel preview verification before merging.

**Preview-deploy spot-check checklist:**

1. `/scorecard/methodology` loads, renders the rewritten doc verbatim.
2. Footer "Methodology v1.3" on every scorecard page links there.
3. Top nav "Methodology" link on `/scorecard` works.
4. Intro paragraph "Read the full methodology" link works.
5. Run `npm run scorecard:compute -- --publish` against the preview's DB (same as prod — Vercel preview shares the production database, so the compute can be run from the local CLI pointing at the same connection string).
6. After compute, open the 5 spot-check legislators listed above; confirm scores match expected direction.
7. Confirm v1.2 rows still exist in DB via a one-off query — methodology version transparency.

## Out of scope (intentional)

- Per-plank standalone scoreboards (`/scorecard/plank/[slug]`). Future feature.
- Re-introducing the hidden "Primary" / "GOP alt" badges. Separate UX pass.
- Methodology v1.4 (e.g. partial credit for amendments, weighted vote-context by committee vs floor). Future.
- Migration off `react-markdown` if a heavier renderer is needed later.

## Test plan

### Unit

- `weightForAchievement(...)` covers all 9 cases in the table.
- `scorePlank` aggregates correctly for a mix of sponsor + vote + PAC achievements.

### Integration

- `compute-scores.ts` run against a small fixture produces expected v1.3 scores per the weight table.

### Manual on preview

- 5-legislator spot check listed above.
- Methodology page renders cleanly on mobile + desktop, all 3 nav links functional.

## Rollback

If the deployed v1.3 produces obviously-wrong scores: revert the merge commit; the previous compute pass's v1.2 rows still exist in DB and become visible again as soon as the page read-filter goes back to `'v1.2'`. No data loss.
