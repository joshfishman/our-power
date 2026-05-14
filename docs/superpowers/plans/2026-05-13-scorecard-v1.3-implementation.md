# Scorecard v1.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship scorecard methodology v1.3 — sponsor-tier weighted scoring plus a public `/scorecard/methodology` page rendering a rewritten advocacy-voice doc, all on a dedicated branch with Vercel preview verification.

**Architecture:** Two coupled changes shipped together on `chore/scorecard-v1.3`. (1) Scoring engine refactored to read full `MarkerAchievement` rows with a `weightForAchievement(...)` helper applying the v1.3 weight table. (2) New server-component route at `/scorecard/methodology` renders `docs/scorecard-methodology.md` via `react-markdown`, linked from 4 existing scorecard pages. Methodology version `v1.2` rows persist in DB; public reads filter to `v1.3` after a one-time recompute. Preview-deploy spot-check against 5 known legislators before merging.

**Tech Stack:** Next.js 15.5.18 (server components) · TypeScript 5 · Prisma 7 · Vitest · react-markdown 9.x + remark-gfm 4.x · Tailwind

**Spec:** [docs/superpowers/specs/2026-05-13-scorecard-v1.3-design.md](docs/superpowers/specs/2026-05-13-scorecard-v1.3-design.md)

---

## File Structure

### Scoring engine (Track A)

- `src/lib/scorecard/scoring.ts` — rewrite `scorePlank` + `scoreLegislator` to consume `MarkerAchievement[]` instead of `Set<markerId>` pairs; new `weightForAchievement()` helper; bump `METHODOLOGY_VERSION` to `'v1.3'`. Keep types narrow to what's needed.
- `src/__tests__/scoring.test.ts` — extend existing test file. 9 unit tests for the weight buckets + a per-plank aggregation test + a per-legislator multi-plank integration test.
- `scripts/compute-scores.ts` — update one call site to pass full achievement rows (with `sponsorTier`, `evidenceType`, `actionTaken`) into the engine.

### Methodology page (Track B)

- `docs/scorecard-methodology.md` — rewrite in advocacy voice. Single source of truth: both engineers and the public read this.
- `src/app/(unprotected)/scorecard/methodology/page.tsx` (new) — server component reads the doc at render time, renders via `react-markdown`.
- `package.json` — adds `react-markdown` + `remark-gfm`.
- `src/app/(unprotected)/scorecard/page.tsx` — top-nav link, intro-paragraph link, footer link.
- `src/app/(unprotected)/scorecard/[id]/page.tsx` — footer link.
- `src/app/(unprotected)/scorecard/bills/[id]/page.tsx` — footer link.
- `src/app/(unprotected)/scorecard/pac/page.tsx` — footer link.

### Spec

- `docs/superpowers/specs/2026-05-13-scorecard-v1.3-design.md` — already authored, committed in Task 1.

---

## Task 1: Create branch + commit spec + baseline snapshot

**Files:**

- No code changes in this task other than committing the existing spec doc.

- [ ] **Step 1: Sync local main + create branch**

```bash
cd /Users/joshuafishman/dev/op
git checkout main && git pull origin main
git checkout -b chore/scorecard-v1.3
```

- [ ] **Step 2: Commit the spec + plan docs to the branch**

```bash
git add docs/superpowers/specs/2026-05-13-scorecard-v1.3-design.md \
        docs/superpowers/plans/2026-05-13-scorecard-v1.3-implementation.md
git commit -m "docs: scorecard v1.3 spec + plan — sponsor weighting + methodology page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Capture baseline**

```bash
npm run typecheck 2>&1 | tail -3
npm run test:run 2>&1 | tail -3
```

Expected: `tsc --noEmit` clean (no errors), `Tests 240 passed (240)`.

---

## Task 2: Add `weightForAchievement` helper + unit tests (TDD)

This task adds the weight function in isolation. `scorePlank` / `scoreLegislator` stay unchanged so the existing test suite keeps passing.

**Files:**

- Modify: `src/lib/scorecard/scoring.ts` (add helper, no signature changes yet)
- Modify: `src/__tests__/scoring.test.ts` (add weight-table tests)

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/scoring.test.ts` (above the existing `describe` blocks is fine; keep them ordered chronologically):

```ts
import { weightForAchievement, type AchievementForScoring } from '@/lib/scorecard/scoring';

describe('weightForAchievement — v1.3 weight table', () => {
  const base = {
    markerId: 'm',
    achieved: true,
    sponsorTier: null,
  } as const;

  it('Author cosponsorship is +3', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'AUTHOR',
    };
    expect(weightForAchievement(a)).toBe(3);
  });

  it('Sponsor cosponsorship is +3', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'SPONSOR',
    };
    expect(weightForAchievement(a)).toBe(3);
  });

  it('Principal Coauthor cosponsorship is +2', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'PRINCIPAL_COAUTHOR',
    };
    expect(weightForAchievement(a)).toBe(2);
  });

  it('Coauthor cosponsorship is +2', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'COAUTHOR',
    };
    expect(weightForAchievement(a)).toBe(2);
  });

  it('Cosponsor cosponsorship is +1', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'COSPONSOR',
    };
    expect(weightForAchievement(a)).toBe(1);
  });

  it('VOTE ACTED_FOR (yes) is +1', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'VOTE', actionTaken: 'ACTED_FOR' };
    expect(weightForAchievement(a)).toBe(1);
  });

  it('VOTE ACTED_AGAINST (no/absent/abstain/excused/present) is -1', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'VOTE', actionTaken: 'ACTED_AGAINST' };
    expect(weightForAchievement(a)).toBe(-1);
  });

  it('PAC FILING under threshold (ACTED_FOR) is +1', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'FEC_FILING', actionTaken: 'ACTED_FOR' };
    expect(weightForAchievement(a)).toBe(1);
    const b: AchievementForScoring = { ...base, evidenceType: 'CAL_ACCESS_FILING', actionTaken: 'ACTED_FOR' };
    expect(weightForAchievement(b)).toBe(1);
  });

  it('PAC FILING over threshold (ACTED_AGAINST) is -1', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'FEC_FILING', actionTaken: 'ACTED_AGAINST' };
    expect(weightForAchievement(a)).toBe(-1);
    const b: AchievementForScoring = { ...base, evidenceType: 'CAL_ACCESS_FILING', actionTaken: 'ACTED_AGAINST' };
    expect(weightForAchievement(b)).toBe(-1);
  });

  it('NO_RECORD contributes 0', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'VOTE', actionTaken: 'NO_RECORD' };
    expect(weightForAchievement(a)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (no exports yet)**

Run: `npx vitest run src/__tests__/scoring.test.ts 2>&1 | tail -15`

Expected: failures with messages like `Module ... has no exported member "weightForAchievement"` and `Module ... has no exported member "AchievementForScoring"`.

- [ ] **Step 3: Add the helper + type to `src/lib/scorecard/scoring.ts`**

Append above the existing `scorePlank` function:

```ts
/**
 * The minimal achievement shape the scoring engine needs to weigh an
 * action. Kept narrow (vs the full Prisma MarkerAchievement) so unit
 * tests stay fast and the scoring engine has no Prisma dependency.
 */
export interface AchievementForScoring {
  markerId: string;
  achieved: boolean;
  actionTaken: AchievementStatus | null;
  evidenceType: 'COSPONSOR' | 'VOTE' | 'FEC_FILING' | 'CAL_ACCESS_FILING' | 'PUBLIC_STATEMENT';
  sponsorTier: 'AUTHOR' | 'PRINCIPAL_COAUTHOR' | 'COAUTHOR' | 'COSPONSOR' | 'SPONSOR' | null;
}

/**
 * Methodology v1.3 weight table — see docs/scorecard-methodology.md
 * for the public-facing rationale.
 *
 *   COSPONSOR Author / Sponsor        → +3
 *   COSPONSOR Principal / Coauthor    → +2
 *   COSPONSOR Cosponsor               → +1
 *   VOTE      ACTED_FOR  (yes)        → +1
 *   VOTE      ACTED_AGAINST           → -1  (NO, NOT_VOTING, EXCUSED,
 *                                            ABSTAINED, PRESENT — every
 *                                            recorded non-yes counts the
 *                                            same: the bill needed your
 *                                            yes to pass)
 *   PAC FILING ACTED_FOR  (under 5%)  → +1
 *   PAC FILING ACTED_AGAINST          → -1
 *   NO_RECORD or absent row           →  0
 */
export function weightForAchievement(a: AchievementForScoring): number {
  if (a.actionTaken !== 'ACTED_FOR' && a.actionTaken !== 'ACTED_AGAINST') return 0;
  const sign = a.actionTaken === 'ACTED_FOR' ? 1 : -1;
  if (a.evidenceType === 'COSPONSOR') {
    if (a.sponsorTier === 'AUTHOR' || a.sponsorTier === 'SPONSOR') return sign * 3;
    if (a.sponsorTier === 'PRINCIPAL_COAUTHOR' || a.sponsorTier === 'COAUTHOR') return sign * 2;
    return sign * 1; // COSPONSOR or unknown tier
  }
  // VOTE / FEC_FILING / CAL_ACCESS_FILING / PUBLIC_STATEMENT all carry magnitude 1.
  return sign;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/scoring.test.ts 2>&1 | tail -10`

Expected: all weight-table tests pass; existing v1.2 plank-sum tests still pass.

- [ ] **Step 5: Run full test suite to confirm nothing regressed**

Run: `npm run test:run 2>&1 | tail -3`

Expected: `Tests 250 passed (250)` (240 baseline + 10 new).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck 2>&1 | tail -3`

Expected: clean (no `error TS` lines).

- [ ] **Step 7: Commit**

```bash
git add src/lib/scorecard/scoring.ts src/__tests__/scoring.test.ts
git commit -m "feat(scorecard): add weightForAchievement helper for v1.3

Additive: introduces the weight-table function + AchievementForScoring
type without changing scorePlank/scoreLegislator yet. Old +1/-1 model
still runs in scorePlank — next task swaps the consumer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rewrite `scorePlank` + `scoreLegislator` to use weights + bump to v1.3

This is the breaking signature change. `forIds`/`againstIds` sets become a single `MarkerAchievement[]` (or compatible). The engine sums weights.

**Files:**

- Modify: `src/lib/scorecard/scoring.ts` (rewrite `scorePlank`, `scoreLegislator`, `LegislatorScoreInput`, `METHODOLOGY_VERSION`)
- Modify: `src/__tests__/scoring.test.ts` (update existing v1.2-era tests to new signature)

- [ ] **Step 1: Update tests for the new signature first**

Replace the existing `set = (...ids: string[]) => new Set(ids);` helper and the `describe('scorePlank — +1 / -1 model', ...)` block (and the scoreLegislator block beneath it) with the new shape. Full replacement block:

```ts
// Helpers for building test achievements.
function ach(markerId: string, kind: 'for' | 'against' | 'norecord' = 'for'): AchievementForScoring {
  return {
    markerId,
    achieved: kind === 'for',
    actionTaken: kind === 'for' ? 'ACTED_FOR' : kind === 'against' ? 'ACTED_AGAINST' : 'NO_RECORD',
    evidenceType: 'VOTE',
    sponsorTier: null,
  };
}

function authoredCosponsor(markerId: string, tier: AchievementForScoring['sponsorTier']): AchievementForScoring {
  return {
    markerId,
    achieved: true,
    actionTaken: 'ACTED_FOR',
    evidenceType: 'COSPONSOR',
    sponsorTier: tier,
  };
}

describe('scorePlank — v1.3 weighted-sum model', () => {
  it('returns 0 when no achievements touch this plank', () => {
    const r = scorePlank(plank, []);
    expect(r.score).toBe(0);
    expect(r.measuredMarkers).toBe(0);
  });

  it('sums weights across markers', () => {
    // +3 (Author) + +1 (vote yes) + -1 (vote no) = +3
    const r = scorePlank(plank, [authoredCosponsor('m1', 'AUTHOR'), ach('m2', 'for'), ach('m3', 'against')]);
    expect(r.score).toBe(3);
    expect(r.forCount).toBe(2);
    expect(r.againstCount).toBe(1);
    expect(r.measuredMarkers).toBe(3);
  });

  it('ignores achievements for markers outside this plank', () => {
    const r = scorePlank(plank, [ach('m1', 'for'), ach('not-on-this-plank', 'for')]);
    expect(r.score).toBe(1);
    expect(r.measuredMarkers).toBe(1);
  });

  it('ignores NO_RECORD achievements', () => {
    const r = scorePlank(plank, [ach('m1', 'for'), ach('m2', 'norecord')]);
    expect(r.score).toBe(1);
    expect(r.measuredMarkers).toBe(1);
  });
});

describe('scoreLegislator — v1.3', () => {
  const planks: ScoringPlank[] = [
    plank,
    {
      id: 'plank-2',
      number: 2,
      markers: [{ id: 'm10', markerType: 'PRIMARY' }],
    },
  ];

  it('aggregates per-plank scores into a total', () => {
    const result = scoreLegislator(planks, {
      legislatorId: 'leg-1',
      achievements: [authoredCosponsor('m1', 'AUTHOR'), ach('m10', 'against')],
    });
    expect(result.total).toBe(2); // +3 + -1
    expect(result.perPlank).toHaveLength(2);
  });

  it('returns 0 for a legislator with no achievements', () => {
    const result = scoreLegislator(planks, {
      legislatorId: 'leg-1',
      achievements: [],
    });
    expect(result.total).toBe(0);
  });
});

describe('METHODOLOGY_VERSION', () => {
  it('is v1.3', () => {
    expect(METHODOLOGY_VERSION).toBe('v1.3');
  });
});
```

Delete the old `describe('scorePlank — +1 / -1 model', ...)` and `describe('scoreLegislator', ...)` blocks (whatever they're named in the current file) — the new ones replace them.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/scoring.test.ts 2>&1 | tail -15`

Expected: failures because (a) `scorePlank` still has the old `(plank, forIds, againstIds)` signature, (b) `scoreLegislator` still uses `forIds`/`againstIds`, (c) `METHODOLOGY_VERSION` is still `'v1.2'`, and (d) `LegislatorScoreResult.perPlank` shape may differ.

- [ ] **Step 3: Update `src/lib/scorecard/scoring.ts`**

Replace the file's `METHODOLOGY_VERSION`, `LegislatorScoreInput`, `LegislatorScoreResult`, `scorePlank`, and `scoreLegislator` declarations. Keep `AchievementForScoring`, `weightForAchievement`, and the existing `ScoringMarker`/`ScoringPlank`/`PlankScoreResult` types — only `PlankScoreResult` gets a small extension (no breaking removal).

Full new content for the changed block:

```ts
export const METHODOLOGY_VERSION = 'v1.3';

export interface PlankScoreResult {
  plankId: string;
  score: number; // signed integer — sum of weighted achievements on this plank
  forCount: number; // count of ACTED_FOR achievements (any weight)
  againstCount: number; // count of ACTED_AGAINST achievements (any weight)
  measuredMarkers: number; // forCount + againstCount
  totalMarkers: number; // markers on this plank we COULD measure
  notes: string;
}

export function scorePlank(plank: ScoringPlank, achievements: readonly AchievementForScoring[]): PlankScoreResult {
  const markerIds = new Set(plank.markers.map((m) => m.id));
  let score = 0;
  let forCount = 0;
  let againstCount = 0;
  for (const a of achievements) {
    if (!markerIds.has(a.markerId)) continue;
    if (a.actionTaken === 'ACTED_FOR') forCount += 1;
    else if (a.actionTaken === 'ACTED_AGAINST') againstCount += 1;
    score += weightForAchievement(a);
  }
  return {
    plankId: plank.id,
    score,
    forCount,
    againstCount,
    measuredMarkers: forCount + againstCount,
    totalMarkers: plank.markers.length,
    notes: `methodology=${METHODOLOGY_VERSION}, score=${
      score >= 0 ? '+' : ''
    }${score} from ${forCount} for / ${againstCount} against`,
  };
}

export interface LegislatorScoreInput {
  legislatorId: string;
  achievements: readonly AchievementForScoring[];
}

export interface LegislatorScoreResult {
  legislatorId: string;
  perPlank: PlankScoreResult[];
  total: number;
  totalFor: number;
  totalAgainst: number;
}

export function scoreLegislator(planks: readonly ScoringPlank[], input: LegislatorScoreInput): LegislatorScoreResult {
  const perPlank = planks.map((p) => scorePlank(p, input.achievements));
  const total = perPlank.reduce((sum, p) => sum + p.score, 0);
  const totalFor = perPlank.reduce((sum, p) => sum + p.forCount, 0);
  const totalAgainst = perPlank.reduce((sum, p) => sum + p.againstCount, 0);
  return {
    legislatorId: input.legislatorId,
    perPlank,
    total,
    totalFor,
    totalAgainst,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/scoring.test.ts 2>&1 | tail -10`

Expected: all scoring.test.ts tests pass.

- [ ] **Step 5: Run typecheck — expect errors at `compute-scores.ts` call site**

Run: `npm run typecheck 2>&1 | tail -10`

Expected: errors in `scripts/compute-scores.ts` because it still passes `{ forIds, againstIds }` to `scoreLegislator`. That's fixed in Task 4. Note the line numbers and proceed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scorecard/scoring.ts src/__tests__/scoring.test.ts
git commit -m "feat(scorecard): rewrite scorePlank for weighted v1.3 model

scorePlank now consumes MarkerAchievement-shaped rows and sums via
weightForAchievement. scoreLegislator and LegislatorScoreInput follow
suit. Methodology version bumped to v1.3.

scripts/compute-scores.ts will fail typecheck after this commit until
Task 4 updates the call site.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Update `compute-scores.ts` consumer

**Files:**

- Modify: `scripts/compute-scores.ts:280-295`

- [ ] **Step 1: Read the current call site**

Open `scripts/compute-scores.ts` lines 280-295. The current code builds `forIds`/`againstIds` sets, passes them in.

- [ ] **Step 2: Replace the call site**

Find the block:

```ts
const forIds = new Set(leg.achievements.filter((a) => a.actionTaken === 'ACTED_FOR').map((a) => a.markerId));
const againstIds = new Set(leg.achievements.filter((a) => a.actionTaken === 'ACTED_AGAINST').map((a) => a.markerId));

const result = scoreLegislator(planksForJurisdiction, {
  legislatorId: leg.id,
  forIds,
  againstIds,
});
```

Replace with:

```ts
const result = scoreLegislator(planksForJurisdiction, {
  legislatorId: leg.id,
  achievements: leg.achievements.map((a) => ({
    markerId: a.markerId,
    achieved: a.achieved,
    actionTaken: a.actionTaken,
    evidenceType: a.evidenceType,
    sponsorTier: a.sponsorTier,
  })),
});
```

- [ ] **Step 3: Verify the Prisma query already selects the fields we need**

Search backward in `compute-scores.ts` for the query that loads `leg.achievements`. It should already include `sponsorTier`, `evidenceType`, `actionTaken`, and `markerId`. If any are missing, add them to the `select` (only the leaf fields, no relations needed).

Run:

```bash
grep -A 15 "achievements:" scripts/compute-scores.ts | head -30
```

Confirm the select includes `sponsorTier: true, evidenceType: true, actionTaken: true, markerId: true, achieved: true` (or equivalent — `where: { verifiedAt: { not: null } }` is fine, just need those fields available).

- [ ] **Step 4: Run typecheck — must be clean now**

Run: `npm run typecheck 2>&1 | tail -3`

Expected: no `error TS` lines.

- [ ] **Step 5: Run the test suite — confirm nothing regressed**

Run: `npm run test:run 2>&1 | tail -3`

Expected: same passing count as Task 2 step 5.

- [ ] **Step 6: Commit**

```bash
git add scripts/compute-scores.ts
git commit -m "feat(scorecard): wire compute-scores to v1.3 weighted engine

Replace forIds/againstIds Set construction with a direct pass-through
of MarkerAchievement rows into the new scoring engine signature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Install `react-markdown` + `remark-gfm`

**Files:**

- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run:

```bash
npm install react-markdown@9 remark-gfm@4
```

- [ ] **Step 2: Verify**

```bash
grep -E '"react-markdown":|"remark-gfm":' package.json
```

Expected: both lines present, versions `^9.x` and `^4.x`.

- [ ] **Step 3: Quick smoke — type lookups work**

Run:

```bash
node -e "console.log(Object.keys(require('react-markdown')).slice(0,5))" 2>&1 | head -3
```

Expected: prints the exported keys (`default`, etc.) without error.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add react-markdown + remark-gfm for /scorecard/methodology

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Rewrite `docs/scorecard-methodology.md` in advocacy voice

**Files:**

- Rewrite: `docs/scorecard-methodology.md`

This is the longest single task. Plan: read the existing doc, then rewrite section-by-section. Single source of truth — engineers reading it for the technical specifics should still get them; voters/journalists should follow without prior context.

- [ ] **Step 1: Read the current doc**

```bash
cat docs/scorecard-methodology.md
```

Take note of the existing structure and all facts that must be preserved (PAC 5% threshold, Option C GOP-alt rule, three-state ACTED_FOR/AGAINST/NO_RECORD, methodology version history v1.0 → v1.3).

- [ ] **Step 2: Replace the doc with the new structure**

Write the new `docs/scorecard-methodology.md` with this outline:

```
# How we score

A short intro paragraph in plain language — what this is, who it scores,
who can read it. Mentions: every member of Congress and the California
State Legislature; same rubric for everyone regardless of party; every
score traces to a public source.

## The basics

Lead with the conceptual model: every legislator earns or loses
points based on what they do on the bills tracked under each plank.
Yes votes and cosponsorship earn points; recorded "no" or "absent"
on a vote loses points; what we have no record of doesn't count.

## The weight table

Headed by a markdown table. Match the design doc table:

| What | Weight |
|---|---|
| Wrote the bill (author / lead sponsor) | +3 |
| Co-led the bill (principal coauthor / coauthor) | +2 |
| Signed on (cosponsor) | +1 |
| Voted yes (committee or floor) | +1 |
| Voted no, or didn't vote when present, or was excused, or abstained, or voted present | −1 |
| Took less than 5% of campaign money from corporate PACs | +1 |
| Took 5% or more from corporate PACs | −1 |

Add the explicit "owning" paragraph about EXCUSED:

> All five non-yes positions count the same: -1. Including officially-excused
> absences. We treat them the same because the bill needed your yes to pass —
> if you weren't there to give it, the procedural effect is identical
> regardless of why.

## The five planks

(Federal — Plank 5 is federal-only.)

For each plank: short tagline + the plank's central commitment in 2-3
sentences. Use the body field from FEDERAL_PLANKS / CA_PLANKS — those
are already public-tone. Mention which planks apply to CA (1-4) vs
federal (1-5).

## Two-tier markers (the Option C rule)

Plain English: some markers credit either the platform's preferred
vehicle OR a Republican-authored alternative that moves the same
direction at smaller magnitude. Both vehicles count.

## Corporate PAC money

Explain how we count it. 5% of total receipts. OpenSecrets for federal
(via direct FEC data); CCDC Cal-Access bulk for California, with a
hand-curated CommitteeClassification table marking which committees
are corporate vs labor / ideological / party / candidate / trade
association.

## What we don't (yet) score

Honest accounting:
- We can't yet score what happens in conference committees, suspense
  files, or "held under submission" — those procedural deaths happen
  off the record.
- We don't yet weight by committee importance (chair vs rank-and-file)
  or amendment authorship.
- We rely on LegiScan for vote records. If they don't have it, we
  don't either.

## Provisional bills

Some markers track bills that haven't been formally introduced yet
(only flagged in our database). We mark these as provisional and
don't score them until LegiScan confirms the bill number against the
official source.

## Methodology versions

| Version | Released | What changed |
|---|---|---|
| v1.0 | 2026-04-29 | Initial 0-5 rubric, primary + secondary markers |
| v1.1 | 2026-04-29 | Three-state position records (acted_for / acted_against / no_record) |
| v1.2 | 2026-05-12 | Switched from 0-5 rubric to signed +1/-1 sum |
| v1.3 | 2026-05-13 | Sponsor-tier weighted scoring (lead author +3, coauthor +2, cosponsor +1) |
```

Drop legacy engineering jargon. Combine "Provisional bill numbers" + "Three-state position records" + "Verification before publication" + "Challenges" from the existing doc into "What we don't (yet) score" and "Provisional bills". Keep the methodology version table for transparency.

Don't fabricate facts. Every plank's policy commitment must reflect what's in `src/lib/scorecard/federal-planks.ts` and `src/lib/scorecard/ca-planks.ts` body fields. Quote or paraphrase faithfully.

- [ ] **Step 3: Commit**

```bash
git add docs/scorecard-methodology.md
git commit -m "docs: rewrite scorecard methodology in advocacy voice for /scorecard/methodology

Single source of truth — engineers still get the technical specifics;
voters and journalists can read it without prior context. Adds the
v1.3 weight table, owns the 'EXCUSED counts -1' choice explicitly,
and adds an honest 'what we don't yet score' section.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Create `/scorecard/methodology` route

**Files:**

- Create: `src/app/(unprotected)/scorecard/methodology/page.tsx`

- [ ] **Step 1: Create the route file**

```tsx
/* eslint-disable react/no-children-prop */
import type { Metadata } from 'next';
import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const metadata: Metadata = {
  title: 'Methodology | We the People Scorecard',
  description:
    'How every member of Congress and the California State Legislature is scored — same rubric for everyone, every point backed by a public source.',
};

// Force-dynamic so doc edits show up without redeploy. The doc is small.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function readMethodologyDoc(): Promise<string> {
  // Resolve relative to repo root. Next 15 server components run with
  // process.cwd() at the project root in both dev and Vercel builds.
  const docPath = path.join(process.cwd(), 'docs', 'scorecard-methodology.md');
  return fs.readFile(docPath, 'utf-8');
}

export default async function MethodologyPage() {
  const markdown = await readMethodologyDoc();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-[#F5DEB3]/80 hover:text-[#F5DEB3]">
        ← Back to scorecard
      </Link>
      <article className="mt-6 text-[#F5DEB3] [&_a]:text-[#8B3A3A] [&_a]:underline hover:[&_a]:text-[#FFE9B8] [&_blockquote]:mt-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[#8B3A3A] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[#F5DEB3]/90 [&_code]:rounded [&_code]:bg-[#2C4A5E]/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mt-8 [&_h1]:border-b-2 [&_h1]:border-[#2C4A5E] [&_h1]:pb-3 [&_h1]:font-serif [&_h1]:text-4xl [&_h1]:font-bold [&_h1]:text-[#F5DEB3] [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-[#F5DEB3] [&_h3]:mt-6 [&_h3]:font-serif [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-[#F5DEB3] [&_li]:mt-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_p]:leading-relaxed [&_p]:text-[#F5DEB3] [&_strong]:font-semibold [&_strong]:text-[#F5DEB3] [&_table]:mt-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border-b [&_td]:border-[#2C4A5E]/40 [&_td]:py-2 [&_td]:pr-4 [&_th]:border-b-2 [&_th]:border-[#2C4A5E] [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-mono [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-[#F5DEB3]/70 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck 2>&1 | tail -3`

Expected: clean.

- [ ] **Step 3: Run the build to confirm Next 15 is happy with the new route**

Run: `npm run build 2>&1 | tail -25`

Expected: build passes, routes table includes `/scorecard/methodology`.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/(unprotected)/scorecard/methodology/page.tsx'
git commit -m "feat(scorecard): public /scorecard/methodology route

Server component reads docs/scorecard-methodology.md at render time
and renders it via react-markdown + remark-gfm. Tailwind selectors on
the wrapping article style headings, tables, blockquotes to match
the scorecard palette (wheat on navy, brick-red links).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Discoverability — add links from 4 scorecard pages

**Files:**

- Modify: `src/app/(unprotected)/scorecard/page.tsx` (3 changes: top nav, intro paragraph, footer)
- Modify: `src/app/(unprotected)/scorecard/[id]/page.tsx` (footer)
- Modify: `src/app/(unprotected)/scorecard/bills/[id]/page.tsx` (footer)
- Modify: `src/app/(unprotected)/scorecard/pac/page.tsx` (footer)

- [ ] **Step 1: Update `/scorecard` footer + intro**

Open `src/app/(unprotected)/scorecard/page.tsx`. Find the footer block (currently `Methodology v1.2.` plain text — should be `v1.3` text after Task 3, but the link work happens here). Replace the footer paragraph with:

```tsx
<footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-500">
  <p>
    <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
      Methodology v1.3 →
    </Link>{' '}
    Same rubric applies to every legislator regardless of party. Every score traces to a public source.
  </p>
  <p className="mt-1">
    Republican-authored alternatives count as secondary markers under the two-tier methodology adopted 2026-04-29.
  </p>
</footer>
```

Find the intro paragraph (currently mentions the +1/-1 model). Append a "Read the full methodology" link:

```tsx
<p className="mt-2 max-w-2xl text-base text-gray-700">
  Every legislator scored against the same {jurisdiction === 'FEDERAL' ? 'five' : 'four'} commitments. Same rubric for
  everyone, every score backed by a public source. Each vote or cosponsorship is +1; each recorded vote-against or
  no-show on a recorded vote is &minus;1.{' '}
  <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
    Read the full methodology →
  </Link>
</p>
```

Find the chamber-toggle nav (the "U.S. Congress / California" Link row). Add a "Methodology" link to the right of it:

```tsx
<nav className="mt-6 flex flex-wrap items-center gap-2 text-sm">
  {/* existing U.S. Congress / California links unchanged */}
  ...
  <Link
    href="/scorecard/methodology"
    className="ml-auto rounded border border-[#2C4A5E] bg-transparent px-3 py-1 text-[#F5DEB3]/80 transition-colors hover:bg-[#2C4A5E]/60 hover:text-[#F5DEB3]">
    Methodology →
  </Link>
</nav>
```

(The `ml-auto` pushes it to the right within the flex row. If the existing flex doesn't have `items-center`, add it.)

- [ ] **Step 2: Update `/scorecard/[id]` footer**

Open `src/app/(unprotected)/scorecard/[id]/page.tsx`. Find the footer paragraph that says `Same rubric applied to every legislator. Methodology v1.2.` (or v1.3 after Task 3). Replace the version mention with a `<Link>`:

```tsx
<footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-500">
  <p>
    Same rubric applied to every legislator.{' '}
    <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
      Methodology v1.3 →
    </Link>{' '}
    <Link href="/scorecard" className="underline">
      See the full scorecard
    </Link>
    .
  </p>
</footer>
```

- [ ] **Step 3: Update `/scorecard/bills/[id]` footer**

Open `src/app/(unprotected)/scorecard/bills/[id]/page.tsx`. The footer currently says `Methodology v1.0. ...`. Update to `Methodology v1.3` as a link:

```tsx
<footer className="mt-12 border-t-2 border-[#2C4A5E] pt-4 text-xs text-[#F5DEB3]/70">
  <p>
    <Link href="/scorecard/methodology" className="underline hover:text-[#F5DEB3]">
      Methodology v1.3 →
    </Link>{' '}
    {bill.isProvisional ? 'Bill number is provisional pending verification against the official source.' : ''}{' '}
    <Link href="/scorecard" className="underline hover:text-[#F5DEB3]">
      See the full scorecard
    </Link>
    .
  </p>
</footer>
```

- [ ] **Step 4: Update `/scorecard/pac` footer**

Open `src/app/(unprotected)/scorecard/pac/page.tsx`. The footer currently says `Methodology v1.0.`. Update to v1.3 link:

```tsx
<footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-500">
  <p>
    Same threshold applied to every legislator. Ranked low-to-high.{' '}
    <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
      Methodology v1.3 →
    </Link>{' '}
    <Link href="/scorecard" className="underline">
      Full scorecard →
    </Link>
  </p>
</footer>
```

- [ ] **Step 5: Verify all four files import Link**

Run:

```bash
grep -l "from 'next/link'" 'src/app/(unprotected)/scorecard/page.tsx' 'src/app/(unprotected)/scorecard/[id]/page.tsx' 'src/app/(unprotected)/scorecard/bills/[id]/page.tsx' 'src/app/(unprotected)/scorecard/pac/page.tsx'
```

Expected: all four paths print. If any are missing the import, add `import Link from 'next/link';` at the top.

- [ ] **Step 6: Run typecheck + build**

```bash
npm run typecheck 2>&1 | tail -3
npm run build 2>&1 | tail -25
```

Expected: typecheck clean; build passes.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/(unprotected)/scorecard/page.tsx' 'src/app/(unprotected)/scorecard/[id]/page.tsx' 'src/app/(unprotected)/scorecard/bills/[id]/page.tsx' 'src/app/(unprotected)/scorecard/pac/page.tsx'
git commit -m "feat(scorecard): link to /scorecard/methodology from all scorecard pages

Three placements per the v1.3 spec:
1. Top nav of /scorecard (right of chamber-toggle row)
2. Intro paragraph of /scorecard (after the +1/-1 explainer)
3. Footer text on /scorecard, /scorecard/[id], /scorecard/bills/[id],
   /scorecard/pac — all now read 'Methodology v1.3 →' linking to the
   new page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Push branch + open PR

**Files:**

- No code changes.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin chore/scorecard-v1.3
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --title "feat(scorecard): v1.3 weighted scoring + public methodology page" --body "$(cat <<'EOF'
## Summary
- Methodology bump v1.2 → v1.3: per-achievement weighted scoring (Author +3, Coauthor +2, Cosponsor +1, vote yes +1, every other recorded position −1, PAC ±1 around 5%).
- New \`/scorecard/methodology\` route renders \`docs/scorecard-methodology.md\` verbatim via react-markdown. Doc rewritten in advocacy voice.
- Methodology link added in three places on every scorecard page (top nav, intro paragraph, footer).
- Single source of truth: doc stays as the engineering+public reference. Old v1.2 rows persist in DB (different \`methodologyVersion\`); reads filter to v1.3 after recompute.

## What stays unchanged
- React 18.3, Next 15.5.18, NextAuth beta.31
- \`MarkerAchievement\` schema (no migration)
- \`RepresentativeScore.forCount\` / \`againstCount\` columns (now hold counts, not signed sums — score is the signed weighted sum stored on \`score\`)
- All ingest pipelines (LegiScan sync, FEC, CAL-ACCESS)

## Test plan
- [x] Local: \`npm run typecheck\` clean
- [x] Local: \`npm run build\` passes
- [x] Local: \`npm run test:run\` — 250+ pass (240 baseline + new weight-table + new aggregation tests)
- [ ] Vercel preview: \`/scorecard/methodology\` renders the rewritten doc
- [ ] Vercel preview: footer link on \`/scorecard\`, \`/scorecard/[id]\`, \`/scorecard/bills/[id]\`, \`/scorecard/pac\` all work
- [ ] Vercel preview: top nav 'Methodology' link on \`/scorecard\` works
- [ ] Vercel preview: intro paragraph 'Read the full methodology' link works
- [ ] **After merging to main**, run compute against production DB and spot-check 5 legislators:
  - Ash Kalra (CalCare author) — expected score jump from sponsorship weighting
  - Bernie Sanders — federal, lots of cosponsorships — expected score jump
  - Sharon Quirk-Silva — high corporate-PAC %, low sponsorship — expected score still negative or near-zero
  - Alexandria Ocasio-Cortez — mix of sponsor + vote — sanity check
  - One Republican incumbent with PAC data — should still score directionally consistent

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch Vercel preview build**

Wait for the preview deploy URL to appear on the PR. Click through the 4 scorecard pages on the preview URL:

- `/scorecard`
- `/scorecard/methodology` — rewritten doc renders
- `/scorecard/K000393` (Sen. Kennedy) — footer link works
- `/scorecard/bills/calcare` — footer link works
- `/scorecard/pac?jurisdiction=CA` — footer link works

If any visual issue, report back, iterate on the branch.

---

## Task 10: Merge + recompute production scores + spot-check

**Files:**

- No code changes.

- [ ] **Step 1: Merge to main**

```bash
gh pr merge --squash --delete-branch
```

Wait for Vercel production deploy.

- [ ] **Step 2: Sync local main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 3: Recompute scores in production**

The compute script uses the production DB via DATABASE_URL in `.env.local`. Run:

```bash
npm run scorecard:compute -- --auto-verify --publish
```

Expected log: `wrote N score row(s) ... — published`. The script writes new rows at `methodologyVersion: 'v1.3'`. Old v1.2 rows remain untouched.

- [ ] **Step 4: Spot-check legislators in browser**

Open `op-pink.vercel.app` and check each of the 5 spot-check legislators:

1. **Ash Kalra** — `/scorecard` → CA → filter to find him. Confirm: total score reflects sponsorship dominance (he's CalCare author = +3 plus other Plank 4 entries).
2. **Bernie Sanders** — federal — `/scorecard/S000033`. Confirm: total score is positive and notably higher than vote-only legislators.
3. **Sharon Quirk-Silva** — CA — `/scorecard/<her openStatesId>`. Confirm: corporate-PAC −1 still drags score (she has high corporate share).
4. **Alexandria Ocasio-Cortez** — `/scorecard/O000172`. Confirm: total reflects mix of sponsor + vote signals.
5. **A Republican incumbent with PAC data** — pick from `/scorecard/pac?jurisdiction=FEDERAL&party=R` (e.g. John Kennedy `K000393`). Confirm: directionally consistent, methodology-fair.

If any of the 5 scores look wildly wrong (e.g., a known progressive author has a negative total, or a known PAC-heavy member has a +20), pause and investigate before declaring done.

- [ ] **Step 5: Mark plan complete**

Add a final note in the plan tracker that v1.3 shipped and recompute was successful. Optionally remove the v1.2 rows from DB with a one-off SQL (out of scope but tracked as a follow-up cleanup).

---

## Out of scope (intentional)

- React 18 → 19. Separate decision.
- Per-plank standalone scoreboards (`/scorecard/plank/[slug]`). Future.
- Re-introducing the hidden "Primary" / "GOP alt" badges with clearer copy. Future.
- Cleaning the older v1.0/v1.1/v1.2 score rows from DB. Auditing artifact; can be done later.
- Migrating off `react-markdown` if performance / SSR-streaming concerns arise. Not anticipated for this size of doc.

## Rollback

If the deployed v1.3 produces obviously-wrong scores in spot-check: `git revert <merge-sha>`, push to main, Vercel redeploys. v1.2 rows are still in the DB and become visible the moment the read filter reverts. No data loss.
