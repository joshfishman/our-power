# Scorecard v1.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship scorecard methodology v1.4 — super-PAC IE inclusion in the corporate-money ratio, continuous PAC gradient (replacing binary ±1), anchored-percent display (`-100%` to `+100%`), plus the UI surfacing of IE data on the PAC scoreboard.

**Architecture:** Methodology v1.3 → v1.4 with three coordinated changes shipped on `chore/scorecard-v1.4`. (1) `PacMoneyData` gains four IE columns and a `combinedCorporateRatio` cache. (2) New `RaceCandidate` model links each legislator to their cycle opponents (FEC + Cal-Access) so corporate IE against opponents counts toward the legislator's "money working for me" score. (3) Continuous PAC marker scoring + percent display via new `ScoreCalibration` row. Old v1.3 score rows persist; reads filter to v1.4 after recompute. Preview-deploy spot-check against 5 known legislators before merging.

**Tech Stack:** Next.js 15.5.18 (server components) · TypeScript 5 · Prisma 7 · Vitest · FEC API (`api.open.fec.gov`) · CCDC bulk Cal-Access exports · OpenSecrets PAC classification CSV

**Spec:** [docs/superpowers/specs/2026-05-14-scorecard-v1.4-design.md](docs/superpowers/specs/2026-05-14-scorecard-v1.4-design.md)

---

## File Structure

### Schema (Task 2)

- `prisma/schema.prisma` — additive: 4 columns on `PacMoneyData`, 1 column on `MarkerAchievement`, 1 new `RaceOutcome` enum, 1 new `RaceCandidate` model, 1 new `ScoreCalibration` model.

### Scoring engine (Tasks 3, 4)

- `src/lib/scorecard/scoring.ts` — gains `pacScoreFromRatio(ratio: number): number` and `rawToPercent(raw: number, posAnchor: number, negAnchor: number): number`. Both pure functions, no DB.
- `src/__tests__/scoring.test.ts` — adds two describe blocks covering anchor + interpolation cases for each.

### Ingest pipelines

- `scripts/ingest-opensecrets-classifications.ts` (new, Task 5) — one-time bulk seed of `CommitteeClassification` from OpenSecrets' public PAC-classification CSV.
- `scripts/ingest-race-candidates.ts` (new, Task 6) — populates `RaceCandidate` from FEC `/candidates` endpoint + Cal-Access Candidacy data.
- `scripts/ingest-fec.ts` (modify, Task 7) — extend to pull Schedule E filings per legislator per cycle, classify spenders, bucket into the four IE columns on `PacMoneyData`.
- `src/lib/scorecard/calaccess-parser.ts` + `scripts/ingest-cal-access.ts` (modify, Task 8) — add a second pass parsing Form 496 IE data from new CCDC tables; same bucketing logic.

### Compute pipeline

- `scripts/compute-scores.ts` (modify, Task 9) — write `MarkerAchievement.achievementScore` for PAC markers using `pacScoreFromRatio(combinedCorporateRatio)`; bump `METHODOLOGY_VERSION` to `'v1.4'`; after the run, compute 95th/5th percentile of raw scores and upsert `ScoreCalibration`.

### UI surfaces

- `src/app/(unprotected)/scorecard/pac/page.tsx` (modify, Task 10) — replace existing PAC columns with the v1.4 column order (Corp IE Supporting prominent, Source + Cycle hidden, "% Corporate Donations" as primary).
- `src/app/(unprotected)/scorecard/page.tsx` (modify, Task 11) — score column shows `+72%` (color-graded) with `+21 raw` underneath; sort by percent descending; data layer reads from `ScoreCalibration`.
- `src/app/(unprotected)/scorecard/[id]/page.tsx` (modify, Task 12) — hero number is percent; per-PAC-marker row shows continuous score + ratio.
- `docs/scorecard-methodology.md` (rewrite, Task 13) — extend v1.3 doc to cover IE inclusion, continuous PAC, percent calibration, opponent linkage, attacks-disclosure. Auto-renders via existing `/scorecard/methodology` route.

### Release

- Task 14 (push + PR + preview verify) + Task 15 (merge + ingest + recompute + spot-check).

---

## Task 1: Branch + baseline + commit spec/plan

- [ ] **Step 1: Sync main + branch**

```bash
cd /Users/joshuafishman/dev/op
git checkout main && git pull origin main
git checkout -b chore/scorecard-v1.4
```

- [ ] **Step 2: Commit the spec + plan docs**

```bash
git add docs/superpowers/specs/2026-05-14-scorecard-v1.4-design.md \
        docs/superpowers/plans/2026-05-14-scorecard-v1.4-implementation.md
git commit -m "docs: scorecard v1.4 spec + plan — IE inclusion, continuous PAC, percent display

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Baseline**

```bash
npm run typecheck 2>&1 | tail -3
npm run test:run 2>&1 | tail -3
```

Expected: `tsc --noEmit` clean; `Tests 246 passed (246)`.

---

## Task 2: Schema additions

**Files:**

- Modify: `prisma/schema.prisma`

Schema is additive only. No destructive migration. Apply via `prisma db push` against the production Supabase DB (the same DB used by Vercel preview deploys).

- [ ] **Step 1: Add 4 columns to `PacMoneyData`**

Find the existing `model PacMoneyData { ... }` block. Add these four columns BEFORE the `dataSource` field:

```prisma
  // v1.4 IE breakdown (nullable; default 0 in queries). corporateIeAgainstSelfAmount
  // is disclosed in the PAC scoreboard but does NOT count toward the combined ratio.
  corporateIeSupportAmount          Decimal?      @db.Decimal(14, 2)
  corporateIeAgainstOpponentAmount  Decimal?      @db.Decimal(14, 2)
  corporateIeAgainstSelfAmount      Decimal?      @db.Decimal(14, 2)
  // Cached v1.4 ratio: (direct corp + IE for + IE vs opponent) / (total receipts + same IE).
  combinedCorporateRatio            Decimal?      @db.Decimal(6, 4)
```

- [ ] **Step 2: Add `achievementScore` column to `MarkerAchievement`**

In `model MarkerAchievement`, before the `verifiedAt` field:

```prisma
  // v1.4 continuous marker score (currently used for PAC marker only — null for all
  // other achievement types). Scoring engine prefers this over the v1.3 integer
  // weight when present.
  achievementScore  Decimal?            @db.Decimal(6, 2)
```

- [ ] **Step 3: Add `RaceOutcome` enum**

After the existing `enum SponsorTier { ... }` block:

```prisma
/// Per-cycle race outcome for a candidate, used to track opponents (B+C in the
/// v1.4 methodology). DECLARED_PENDING covers active-cycle candidates who've
/// filed paperwork but the election hasn't happened yet.
enum RaceOutcome {
  WON
  LOST_GENERAL
  LOST_PRIMARY
  DECLARED_PENDING
}
```

- [ ] **Step 4: Add `RaceCandidate` model**

After the existing `model PacMoneyData` block:

```prisma
/// Tracks every candidate who has run (or is currently running) for a
/// legislator's seat, across cycles. Used by v1.4's "money working for me"
/// ratio to count corporate IE spending against the legislator's opponents.
/// Indexed for "who ran against legislator X in cycle Y" lookups.
model RaceCandidate {
  id                   String        @id @default(cuid())
  legislator           Legislator?   @relation(fields: [legislatorId], references: [id], onDelete: SetNull)
  legislatorId         String?
  cycleYear            Int
  jurisdiction         Jurisdiction
  state                String
  chamber              Chamber
  district             Int?
  externalCandidateId  String
  candidateName        String
  outcome              RaceOutcome

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([cycleYear, externalCandidateId])
  @@index([cycleYear, jurisdiction, state, chamber, district])
}
```

Also add the reverse relation to `Legislator`. Find the existing `model Legislator { ... }` block and after `pacData PacMoneyData[]` add:

```prisma
  races RaceCandidate[]
```

- [ ] **Step 5: Add `ScoreCalibration` model**

After `RaceCandidate`:

```prisma
/// Stores the per-methodology-version percentile anchors used to map raw signed
/// scores to the -100% to +100% display range. Written once per methodology
/// version by compute-scores after the first run. Frozen until the next
/// methodology bump.
model ScoreCalibration {
  id                 String   @id @default(cuid())
  methodologyVersion String   @unique
  positiveAnchor     Decimal  @db.Decimal(8, 2)
  negativeAnchor     Decimal  @db.Decimal(8, 2)
  computedAt         DateTime @default(now())
  computedFromCount  Int
}
```

- [ ] **Step 6: Push schema + regenerate client**

```bash
cd /Users/joshuafishman/dev/op
npx prisma db push 2>&1 | tail -5
npx prisma generate 2>&1 | tail -3
```

Expected output for `db push`: `Your database is now in sync with your Prisma schema.` followed by the regenerate.

- [ ] **Step 7: Verify schema landed in client**

```bash
grep -E "corporateIeSupportAmount|achievementScore|RaceCandidate|ScoreCalibration" src/generated/prisma/internal/class.ts | head -10
```

Expected: at least 4 lines confirming each new symbol is in the generated client.

- [ ] **Step 8: Typecheck + tests still pass**

```bash
npm run typecheck 2>&1 | tail -3
npm run test:run 2>&1 | tail -3
```

Expected: clean + 246 passed.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(scorecard): v1.4 schema — IE columns, RaceCandidate, ScoreCalibration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `pacScoreFromRatio` continuous PAC gradient (TDD)

**Files:**

- Modify: `src/lib/scorecard/scoring.ts` (add function)
- Modify: `src/__tests__/scoring.test.ts` (add describe block)

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/scoring.test.ts`:

```ts
import { pacScoreFromRatio } from '@/lib/scorecard/scoring';

describe('pacScoreFromRatio — v1.4 continuous gradient', () => {
  it('returns +2 at zero corporate', () => {
    expect(pacScoreFromRatio(0)).toBeCloseTo(2);
  });
  it('returns +1 at exactly 5%', () => {
    expect(pacScoreFromRatio(0.05)).toBeCloseTo(1);
  });
  it('returns 0 at 15%', () => {
    expect(pacScoreFromRatio(0.15)).toBeCloseTo(0);
  });
  it('returns -1 at 35%', () => {
    expect(pacScoreFromRatio(0.35)).toBeCloseTo(-1);
  });
  it('returns -2 at 65%', () => {
    expect(pacScoreFromRatio(0.65)).toBeCloseTo(-2);
  });
  it('returns -3 at 85%', () => {
    expect(pacScoreFromRatio(0.85)).toBeCloseTo(-3);
  });
  it('clamps to -3 above 85%', () => {
    expect(pacScoreFromRatio(0.95)).toBeCloseTo(-3);
    expect(pacScoreFromRatio(1.0)).toBeCloseTo(-3);
  });
  it('clamps to +2 below 0', () => {
    // Shouldn't happen in practice but worth covering
    expect(pacScoreFromRatio(-0.1)).toBeCloseTo(2);
  });
  it('interpolates linearly between anchors — 2.5% → +1.5', () => {
    expect(pacScoreFromRatio(0.025)).toBeCloseTo(1.5);
  });
  it('interpolates linearly between anchors — 10% → +0.5', () => {
    expect(pacScoreFromRatio(0.1)).toBeCloseTo(0.5);
  });
  it('interpolates linearly between anchors — 50% → -1.5', () => {
    expect(pacScoreFromRatio(0.5)).toBeCloseTo(-1.5);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/__tests__/scoring.test.ts 2>&1 | tail -15
```

Expected: failures because `pacScoreFromRatio` isn't exported yet.

- [ ] **Step 3: Implement the function**

Append to `src/lib/scorecard/scoring.ts` (above the existing `scorePlank` function):

```ts
/**
 * Methodology v1.4 continuous PAC gradient. Maps a combined corporate-money
 * ratio (direct + IE in numerator, total receipts + same IE in denominator)
 * to a marker score in [-3, +2].
 *
 *   ratio 0.00 → +2  (real zero — reward maximally)
 *   ratio 0.05 → +1  (the v1.3 threshold — partial credit)
 *   ratio 0.15 → 0   (neutral)
 *   ratio 0.35 → -1
 *   ratio 0.65 → -2
 *   ratio 0.85 → -3  (floor — corporate dominance)
 *
 * Linear interpolation between anchors. Clamped at endpoints. The reward for
 * being at "real zero" (0%) is bigger than the cliff at the v1.3 threshold,
 * so legislators who genuinely refuse corporate money get more credit than
 * those who just barely qualify.
 */
const PAC_ANCHORS: ReadonlyArray<[ratio: number, score: number]> = [
  [0.0, 2.0],
  [0.05, 1.0],
  [0.15, 0.0],
  [0.35, -1.0],
  [0.65, -2.0],
  [0.85, -3.0],
];

export function pacScoreFromRatio(ratio: number): number {
  if (ratio <= PAC_ANCHORS[0][0]) return PAC_ANCHORS[0][1];
  if (ratio >= PAC_ANCHORS[PAC_ANCHORS.length - 1][0]) return PAC_ANCHORS[PAC_ANCHORS.length - 1][1];
  for (let i = 1; i < PAC_ANCHORS.length; i += 1) {
    const [r1, s1] = PAC_ANCHORS[i - 1];
    const [r2, s2] = PAC_ANCHORS[i];
    if (ratio <= r2) {
      const t = (ratio - r1) / (r2 - r1);
      return s1 + t * (s2 - s1);
    }
  }
  return PAC_ANCHORS[PAC_ANCHORS.length - 1][1]; // unreachable
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/__tests__/scoring.test.ts 2>&1 | tail -10
```

Expected: 11 new tests pass; existing scoring tests still pass.

- [ ] **Step 5: Full test suite + typecheck**

```bash
npm run test:run 2>&1 | tail -3
npm run typecheck 2>&1 | tail -3
```

Expected: 257 passed (246 + 11) + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scorecard/scoring.ts src/__tests__/scoring.test.ts
git commit -m "feat(scorecard): add pacScoreFromRatio continuous gradient for v1.4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `rawToPercent` anchored-percent display (TDD)

**Files:**

- Modify: `src/lib/scorecard/scoring.ts`
- Modify: `src/__tests__/scoring.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/scoring.test.ts`:

```ts
import { rawToPercent } from '@/lib/scorecard/scoring';

describe('rawToPercent — v1.4 anchored display', () => {
  it('returns 0% at raw 0', () => {
    expect(rawToPercent(0, 25, -10)).toBe(0);
  });
  it('returns 100% at positive anchor', () => {
    expect(rawToPercent(25, 25, -10)).toBe(100);
  });
  it('returns -100% at negative anchor', () => {
    expect(rawToPercent(-10, 25, -10)).toBe(-100);
  });
  it('returns 50% halfway up positive side', () => {
    expect(rawToPercent(12.5, 25, -10)).toBe(50);
  });
  it('returns -50% halfway down negative side', () => {
    expect(rawToPercent(-5, 25, -10)).toBe(-50);
  });
  it('clamps above positive anchor to +100', () => {
    expect(rawToPercent(100, 25, -10)).toBe(100);
  });
  it('clamps below negative anchor to -100', () => {
    expect(rawToPercent(-50, 25, -10)).toBe(-100);
  });
  it('handles asymmetric anchors correctly', () => {
    // positive scale is +25, negative scale is -8
    expect(rawToPercent(12.5, 25, -8)).toBe(50); // halfway up
    expect(rawToPercent(-4, 25, -8)).toBe(-50); // halfway down
  });
  it('returns 0% when both anchors are 0 (defensive)', () => {
    expect(rawToPercent(5, 0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/__tests__/scoring.test.ts -t "rawToPercent" 2>&1 | tail -15
```

Expected: 9 failing tests because `rawToPercent` isn't exported.

- [ ] **Step 3: Implement the function**

Append to `src/lib/scorecard/scoring.ts` after `pacScoreFromRatio`:

```ts
/**
 * Maps a raw signed score to an anchored percentage in [-100, +100]. Anchors
 * are picked empirically from the methodology-version's first compute (95th
 * percentile of positives → +100%; 5th percentile of negatives → -100%) and
 * frozen for the lifetime of that version. Asymmetric by design — the positive
 * range typically extends further than the negative because most achievements
 * carry positive weights.
 *
 * @param raw          The signed integer-or-decimal score.
 * @param posAnchor    Raw score that maps to +100%.
 * @param negAnchor    Raw score that maps to -100% (negative number).
 */
export function rawToPercent(raw: number, posAnchor: number, negAnchor: number): number {
  if (raw === 0 || (posAnchor === 0 && negAnchor === 0)) return 0;
  if (raw > 0) {
    if (posAnchor <= 0) return 0;
    return Math.min(100, (raw / posAnchor) * 100);
  }
  if (negAnchor >= 0) return 0;
  return Math.max(-100, (raw / Math.abs(negAnchor)) * 100);
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/__tests__/scoring.test.ts -t "rawToPercent" 2>&1 | tail -10
```

Expected: 9 tests pass.

- [ ] **Step 5: Full suite + typecheck**

```bash
npm run test:run 2>&1 | tail -3
npm run typecheck 2>&1 | tail -3
```

Expected: 266 passed (257 + 9) + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scorecard/scoring.ts src/__tests__/scoring.test.ts
git commit -m "feat(scorecard): add rawToPercent for v1.4 anchored display

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: OpenSecrets `CommitteeClassification` bulk seed

**Files:**

- Create: `scripts/ingest-opensecrets-classifications.ts`
- Modify: `package.json` (new npm script)

OpenSecrets publishes a public CSV mapping FEC committee IDs to their `RealCode` industry classifications. The CSV URL is documented at `https://www.opensecrets.org/open-data/downloads` under "PAC and Industry classification." For this plan, the relevant file is `CmteIds.txt` (FEC committee → PrimCode → SecCode → CatCode → Catname → Catorder), shipped as part of the bulk-data dump.

If the URL changes between writing and implementing, the implementer should look up "OpenSecrets RealCode FEC committee classification" and adjust the fetch URL. The data format we need: at minimum `Cmte_ID`, `Catname` (or `PrimCode` → category lookup).

**Mapping rule (OpenSecrets RealCode top-level → our `CommitteeCategory`):**

| OpenSecrets category                                        | Our enum                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `Business`, `Corporate`, any "for-profit industry" RealCode | `CORPORATE`                                                        |
| `Labor`                                                     | `LABOR`                                                            |
| `Party`, anything explicitly party-affiliated               | `PARTY`                                                            |
| `Single-Issue / Ideological`                                | `IDEOLOGICAL`                                                      |
| `Candidate` / candidate-controlled                          | `CANDIDATE`                                                        |
| Trade association explicitly                                | `TRADE_ASSOCIATION`                                                |
| anything not in the above buckets                           | `UNCLASSIFIED` (don't insert — let conservative attribution apply) |

- [ ] **Step 1: Create the script**

Create `scripts/ingest-opensecrets-classifications.ts`:

```ts
// One-time-ish bulk seed of CommitteeClassification from OpenSecrets'
// publicly-downloadable RealCode CSV.
//
// Usage:
//   npm run scorecard:ingest-opensecrets-classifications
//   npm run scorecard:ingest-opensecrets-classifications -- --csv=path/to/local.csv
//   npm run scorecard:ingest-opensecrets-classifications -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import https from 'node:https';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

// Documented at https://www.opensecrets.org/open-data/downloads. Update if
// they rotate the URL.
const OPENSECRETS_CSV_URL = 'https://www.opensecrets.org/downloads/crp/CmteIds-current.csv';

interface CliFlags {
  csvPath: string | null;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { csvPath: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--csv=')) flags.csvPath = arg.split('=')[1];
  }
  return flags;
}

async function fetchCsv(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

type Category = 'CORPORATE' | 'LABOR' | 'PARTY' | 'IDEOLOGICAL' | 'CANDIDATE' | 'TRADE_ASSOCIATION';

function mapOpenSecretsToCategory(primCode: string, catName: string): Category | null {
  const cat = catName.toLowerCase();
  if (cat.includes('labor') || cat.includes('union')) return 'LABOR';
  if (cat.includes('party') || cat.includes('committee on political')) return 'PARTY';
  if (cat.includes('candidate')) return 'CANDIDATE';
  if (cat.includes('trade association')) return 'TRADE_ASSOCIATION';
  if (cat.includes('ideolog') || cat.includes('single-issue') || cat.includes('non-connected')) {
    return 'IDEOLOGICAL';
  }
  // RealCode top-level alphabetic prefixes: A-N are business / industry buckets.
  // If we have a primCode and no other category mapped, treat as corporate.
  if (primCode && /^[A-Q]/.test(primCode)) return 'CORPORATE';
  return null;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-opensecrets] flags: ${JSON.stringify(flags)}`);

  const csv = flags.csvPath ? await fs.readFile(flags.csvPath, 'utf-8') : await fetchCsv(OPENSECRETS_CSV_URL);

  console.log(`[ingest-opensecrets] CSV size: ${csv.length} bytes`);

  let mapped = 0;
  let skipped = 0;
  let upserted = 0;

  const parser = Readable.from(csv).pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true }));

  for await (const row of parser) {
    const fecCommitteeId = (row.Cmte_ID || row.CMTEID || row.committee_id || '').trim();
    if (!fecCommitteeId) {
      skipped += 1;
      continue;
    }
    const primCode = (row.PrimCode || row.prim_code || '').trim();
    const catName = (row.Catname || row.cat_name || row.category || '').trim();
    const mappedCat = mapOpenSecretsToCategory(primCode, catName);
    if (!mappedCat) {
      skipped += 1;
      continue;
    }
    mapped += 1;
    if (flags.dryRun) continue;
    await prisma.committeeClassification.upsert({
      where: { jurisdiction_committeeId: { jurisdiction: 'FEDERAL', committeeId: fecCommitteeId } },
      create: {
        jurisdiction: 'FEDERAL',
        committeeId: fecCommitteeId,
        committeeName: row.Cmte_Name ?? row.cmte_name ?? '',
        category: mappedCat,
        sourceUrl: 'https://www.opensecrets.org/open-data/downloads',
      },
      update: {
        category: mappedCat,
        committeeName: row.Cmte_Name ?? row.cmte_name ?? '',
        sourceUrl: 'https://www.opensecrets.org/open-data/downloads',
      },
    });
    upserted += 1;
  }

  console.log(
    `[ingest-opensecrets] summary: mapped=${mapped}, upserted=${upserted}, skipped=${skipped}${
      flags.dryRun ? ' (dry-run)' : ''
    }`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`, add to the `scripts` section alongside the other `scorecard:` scripts:

```json
    "scorecard:ingest-opensecrets-classifications": "npx tsx ./scripts/ingest-opensecrets-classifications.ts",
```

- [ ] **Step 3: Dry-run test the script**

If the OpenSecrets URL fetches successfully:

```bash
npm run scorecard:ingest-opensecrets-classifications -- --dry-run 2>&1 | tail -15
```

Expected output: at least several thousand rows mapped + dry-run summary.

**If the fetch URL fails (404, redirect, format change):** the implementer should report DONE_WITH_CONCERNS, capture the exact error, and the user can manually download the CSV from `https://www.opensecrets.org/open-data/downloads`, place it locally, and re-run with `--csv=path/to/local.csv`.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-opensecrets-classifications.ts package.json
git commit -m "feat(scorecard): one-time OpenSecrets bulk seed for CommitteeClassification

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Note: the actual data ingestion (not just dry-run) happens in Task 15 after merge.

---

## Task 6: `RaceCandidate` ingest script

**Files:**

- Create: `scripts/ingest-race-candidates.ts`
- Modify: `package.json`

Pulls candidate-master records from FEC + Cal-Access into `RaceCandidate`. The legislator-link (`legislatorId`) is filled in when the candidate matches an existing legislator (by FEC bioguide ID or Cal-Access openStatesId where derivable, else by name + state + chamber + district fuzzy match using the `normalizeName` + `lastNameTokensOverlap` helpers from `calaccess-parser.ts`).

- [ ] **Step 1: Create the script**

Create `scripts/ingest-race-candidates.ts`:

```ts
// Populate RaceCandidate from FEC + Cal-Access candidate-master data.
// One-time-ish for past cycles + ongoing for the upcoming cycle.
//
// Usage:
//   npm run scorecard:ingest-race-candidates -- --cycles=2022,2024,2026,2028
//   npm run scorecard:ingest-race-candidates -- --cycles=2026 --jurisdiction=FEDERAL
//   npm run scorecard:ingest-race-candidates -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeName, lastNameTokensOverlap } from '../src/lib/scorecard/calaccess-parser';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const FEC_API_BASE = 'https://api.open.fec.gov/v1';

interface CliFlags {
  cycles: number[];
  jurisdiction: 'FEDERAL' | 'CA' | 'BOTH';
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { cycles: [2024, 2026, 2028], jurisdiction: 'BOTH', dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--cycles=')) {
      flags.cycles = arg
        .split('=')[1]
        .split(',')
        .map((s) => parseInt(s, 10))
        .filter(Number.isFinite);
    } else if (arg.startsWith('--jurisdiction=')) {
      const v = arg.split('=')[1].toUpperCase();
      if (v === 'FEDERAL' || v === 'CA' || v === 'BOTH') flags.jurisdiction = v as CliFlags['jurisdiction'];
    }
  }
  return flags;
}

interface FecCandidate {
  candidate_id: string;
  name: string;
  party: string | null;
  office: 'H' | 'S' | 'P';
  state: string;
  district: string | null;
  cycles: number[];
  // Future / current cycle? FEC returns one row per candidate; their `cycles` array
  // tells us which cycles they've been active in.
}

async function fetchFecCandidatesForCycle(cycle: number): Promise<FecCandidate[]> {
  const apiKey = process.env.FEC_API_KEY || process.env.FEC_DATA_API;
  if (!apiKey) throw new Error('FEC_API_KEY / FEC_DATA_API not set in env');
  const out: FecCandidate[] = [];
  // FEC paginates at 100/page
  let page = 1;
  while (true) {
    const url = `${FEC_API_BASE}/candidates/?api_key=${apiKey}&cycle=${cycle}&office=H&office=S&per_page=100&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FEC API failed: ${res.status} ${res.statusText} (page ${page})`);
    const data = (await res.json()) as { results?: FecCandidate[]; pagination?: { pages?: number } };
    out.push(...(data.results ?? []));
    const pages = data.pagination?.pages ?? 1;
    if (page >= pages) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 100)); // gentle pacing
  }
  return out;
}

async function resolveLegislatorForFecCandidate(c: FecCandidate): Promise<string | null> {
  // FEC candidate_id is not bioguideId. Match by name + state + chamber + district.
  const chamber = c.office === 'S' ? 'SEN' : c.office === 'H' ? 'REP' : null;
  if (!chamber) return null;
  const candidates = await prisma.legislator.findMany({
    where: {
      jurisdiction: 'FEDERAL',
      state: c.state,
      chamber,
      ...(c.district ? { district: parseInt(c.district, 10) } : {}),
    },
    select: { id: true, fullName: true },
  });
  if (candidates.length === 0) return null;
  // Match using token-overlap
  const matched = candidates.find((leg) => lastNameTokensOverlap(leg.fullName, c.name));
  return matched?.id ?? null;
}

function outcomeFromFec(c: FecCandidate, cycle: number): 'WON' | 'LOST_GENERAL' | 'LOST_PRIMARY' | 'DECLARED_PENDING' {
  // FEC's `cycles` includes the cycle where they were a candidate. If the cycle
  // is in the future relative to the latest election cycle in our DB, mark as
  // DECLARED_PENDING. Otherwise we don't have enough signal from /candidates
  // alone to know win/loss — leave LOST_GENERAL as conservative default; a
  // follow-up pass against /candidates/?has_raised_funds=true + election results
  // can refine. For v1.4 the WON/LOST distinction matters less than the
  // DECLARED_PENDING flag (which gates "C: active opponents").
  const currentYear = new Date().getFullYear();
  if (cycle >= currentYear) return 'DECLARED_PENDING';
  return 'LOST_GENERAL';
}

async function ingestFederalForCycle(cycle: number, dryRun: boolean): Promise<number> {
  console.log(`[ingest-race-candidates] FEDERAL cycle=${cycle}: fetching candidates…`);
  const candidates = await fetchFecCandidatesForCycle(cycle);
  console.log(`  fetched ${candidates.length} candidates`);
  let upserted = 0;
  for (const c of candidates) {
    const chamber: 'SEN' | 'REP' = c.office === 'S' ? 'SEN' : 'REP';
    const legislatorId = await resolveLegislatorForFecCandidate(c);
    const outcome = outcomeFromFec(c, cycle);
    if (dryRun) {
      upserted += 1;
      continue;
    }
    await prisma.raceCandidate.upsert({
      where: { cycleYear_externalCandidateId: { cycleYear: cycle, externalCandidateId: c.candidate_id } },
      create: {
        cycleYear: cycle,
        externalCandidateId: c.candidate_id,
        candidateName: c.name,
        outcome,
        jurisdiction: 'FEDERAL',
        state: c.state,
        chamber,
        district: c.district ? parseInt(c.district, 10) : null,
        legislatorId,
      },
      update: {
        candidateName: c.name,
        outcome,
        legislatorId,
      },
    });
    upserted += 1;
  }
  return upserted;
}

// CA ingest: parses Cal-Access candidacy data from existing CCDC bulk on disk.
// Form 501 (Candidate Intention Statement) is the canonical "who's running" form.
// Per implementation discovery: the candidacy table in CCDC bulk is likely
// `f501_502_cd.csv` or `candidate_term_cd.csv`. Implementer verifies which.
async function ingestCaForCycle(_cycle: number, _dryRun: boolean): Promise<number> {
  console.log(`[ingest-race-candidates] CA cycle=${_cycle}: implementation deferred to Task 6 follow-up`);
  // Stub for now — will be filled in once the CCDC table name is verified.
  // For v1.4 launch, federal-only RaceCandidate data is sufficient to
  // demonstrate the methodology; CA can be backfilled via a follow-up script
  // call without changing any code below this script.
  return 0;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-race-candidates] flags: ${JSON.stringify(flags)}`);
  let total = 0;
  for (const cycle of flags.cycles) {
    if (flags.jurisdiction !== 'CA') total += await ingestFederalForCycle(cycle, flags.dryRun);
    if (flags.jurisdiction !== 'FEDERAL') total += await ingestCaForCycle(cycle, flags.dryRun);
  }
  console.log(`[ingest-race-candidates] total upserted: ${total}${flags.dryRun ? ' (dry-run)' : ''}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`:

```json
    "scorecard:ingest-race-candidates": "npx tsx ./scripts/ingest-race-candidates.ts",
```

- [ ] **Step 3: Dry-run test against 2026 federal cycle**

```bash
npm run scorecard:ingest-race-candidates -- --cycles=2026 --jurisdiction=FEDERAL --dry-run 2>&1 | tail -15
```

Expected: fetches several hundred FEC candidates, dry-run reports the upsert count.

If FEC API errors out (rate limit, key invalid), report DONE_WITH_CONCERNS.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-race-candidates.ts package.json
git commit -m "feat(scorecard): RaceCandidate ingest from FEC (CA stubbed for follow-up)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Federal Schedule E ingest extension

**Files:**

- Modify: `scripts/ingest-fec.ts` (extend with Schedule E pass)

`scripts/ingest-fec.ts` currently fetches candidate-summary data and writes `PacMoneyData` rows with `corporatePacAmount` + `totalReceipts`. Task 7 extends the existing per-legislator loop to ALSO fetch Schedule E (IE) filings and populate the four new IE columns + the `combinedCorporateRatio`.

- [ ] **Step 1: Read the current `scripts/ingest-fec.ts` to find the per-legislator write block**

```bash
grep -n "pacMoneyData.upsert\|dataSource: 'FEC_DIRECT'" scripts/ingest-fec.ts
```

Locate the existing upsert block (it's roughly around line 280-310 based on the previous edits to this file).

- [ ] **Step 2: Add a helper function near the top of the file (above `main`)**

```ts
interface ScheduleEFiling {
  candidate_id: string;
  committee_id: string;
  support_oppose_indicator: 'S' | 'O' | null;
  expenditure_amount: number;
  expenditure_date: string | null;
}

async function fetchScheduleEForCandidate(
  candidateId: string,
  cycle: number,
  apiKey: string,
): Promise<ScheduleEFiling[]> {
  const out: ScheduleEFiling[] = [];
  let page = 1;
  while (true) {
    const url =
      `https://api.open.fec.gov/v1/schedules/schedule_e/` +
      `?api_key=${apiKey}&candidate_id=${candidateId}&cycle=${cycle}` +
      `&per_page=100&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) {
      // Some candidates have no IE filings; FEC returns 404 in some cases. Don't fail the whole run.
      if (res.status === 404) return out;
      throw new Error(`Schedule E fetch failed for ${candidateId} cycle ${cycle}: ${res.status}`);
    }
    const data = (await res.json()) as { results?: ScheduleEFiling[]; pagination?: { pages?: number } };
    out.push(...(data.results ?? []));
    const pages = data.pagination?.pages ?? 1;
    if (page >= pages) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

interface IeBuckets {
  corporateIeSupportAmount: number;
  corporateIeAgainstOpponentAmount: number;
  corporateIeAgainstSelfAmount: number;
}

async function classifyIeBuckets(
  legislatorFecId: string,
  opponentFecIds: ReadonlyArray<string>,
  cycle: number,
  apiKey: string,
  prisma: PrismaClient,
): Promise<IeBuckets> {
  // Pull IE FOR or AGAINST this legislator
  const selfFilings = await fetchScheduleEForCandidate(legislatorFecId, cycle, apiKey);
  let support = 0;
  let againstSelf = 0;
  const classifiedCorpCache = new Map<string, boolean>();
  async function isCorpCommittee(committeeId: string): Promise<boolean> {
    if (classifiedCorpCache.has(committeeId)) return classifiedCorpCache.get(committeeId)!;
    const row = await prisma.committeeClassification.findUnique({
      where: { jurisdiction_committeeId: { jurisdiction: 'FEDERAL', committeeId } },
      select: { category: true },
    });
    const isCorp = row?.category === 'CORPORATE' || row?.category === 'TRADE_ASSOCIATION';
    classifiedCorpCache.set(committeeId, isCorp);
    return isCorp;
  }
  for (const f of selfFilings) {
    if (!(await isCorpCommittee(f.committee_id))) continue;
    if (f.support_oppose_indicator === 'S') support += f.expenditure_amount;
    else if (f.support_oppose_indicator === 'O') againstSelf += f.expenditure_amount;
  }
  // Pull IE AGAINST any of this legislator's same-cycle opponents
  let againstOpp = 0;
  for (const oppId of opponentFecIds) {
    const oppFilings = await fetchScheduleEForCandidate(oppId, cycle, apiKey);
    for (const f of oppFilings) {
      if (f.support_oppose_indicator !== 'O') continue;
      if (!(await isCorpCommittee(f.committee_id))) continue;
      againstOpp += f.expenditure_amount;
    }
  }
  return {
    corporateIeSupportAmount: support,
    corporateIeAgainstOpponentAmount: againstOpp,
    corporateIeAgainstSelfAmount: againstSelf,
  };
}
```

- [ ] **Step 3: Modify the per-legislator loop**

Find the loop that currently iterates legislators and writes `PacMoneyData`. Before the `prisma.pacMoneyData.upsert(...)` call, look up the legislator's FEC candidate_id and opponents.

```ts
// Inside the existing per-legislator loop, AFTER you have direct
// pacContribs + totalReceipts:

const legislatorFecId = leg.fecIds[0]; // first FEC id; null-safe below

// Look up same-cycle opponents
const opponents = await prisma.raceCandidate.findMany({
  where: {
    cycleYear: actualCycle,
    jurisdiction: 'FEDERAL',
    state: leg.state,
    chamber: leg.chamber,
    district: leg.district,
    // exclude self by candidate_id (FEC id, NOT legislator id)
    NOT: legislatorFecId ? { externalCandidateId: legislatorFecId } : undefined,
  },
  select: { externalCandidateId: true },
});
const opponentFecIds = opponents.map((o) => o.externalCandidateId);

let ieBuckets: IeBuckets = {
  corporateIeSupportAmount: 0,
  corporateIeAgainstOpponentAmount: 0,
  corporateIeAgainstSelfAmount: 0,
};
if (legislatorFecId) {
  ieBuckets = await classifyIeBuckets(legislatorFecId, opponentFecIds, actualCycle, apiKey, prisma);
}

const combinedNumerator = pacContribs + ieBuckets.corporateIeSupportAmount + ieBuckets.corporateIeAgainstOpponentAmount;
const combinedDenominator =
  totalReceipts + ieBuckets.corporateIeSupportAmount + ieBuckets.corporateIeAgainstOpponentAmount;
const combinedCorporateRatio = combinedDenominator > 0 ? combinedNumerator / combinedDenominator : 0;
```

Then in the existing `prisma.pacMoneyData.upsert(...)` call, add these fields to BOTH `create` and `update`:

```ts
        corporateIeSupportAmount: ieBuckets.corporateIeSupportAmount,
        corporateIeAgainstOpponentAmount: ieBuckets.corporateIeAgainstOpponentAmount,
        corporateIeAgainstSelfAmount: ieBuckets.corporateIeAgainstSelfAmount,
        combinedCorporateRatio,
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 5: Smoke test against ONE legislator on production DB (dry-run mode)**

If `scripts/ingest-fec.ts` doesn't have a `--dry-run` flag, add one that prints what would be written without actually writing. Run:

```bash
# Add a --candidate=S4LA00065 flag if it doesn't exist, or just run the full script
# in dry-run mode and let it process a few legislators. Cancel after observing
# a few rows of expected output.
npm run scorecard:ingest-fec -- --dry-run --cycle=2026 2>&1 | head -40
```

Expected: the script fetches Schedule E for each legislator, classifies, and prints bucket totals. If FEC rate-limits, the script should retry — if it doesn't, that's a separate issue to capture.

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest-fec.ts
git commit -m "feat(scorecard): extend FEC ingest with Schedule E for v1.4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: CA Form 496 IE parser

**⚠ Upstream dependency before this task can start:**

The CA CCDC bulk export we have on disk at `data/calaccess/raw/` contains only Form 460 (campaign disclosure) data — 6 CSV files. Form 496 (Late Independent Expenditure Report) and the related expenditure tables live in different CSVs from biglocalnews.org. **The user must download those additional files before the parser can be written or tested.**

**Files we need from biglocalnews.org (CCDC's CAL-ACCESS dataset):**

- `s496_cd.csv` — Schedule 496 (Late Independent Expenditures)
- `expn_cd.csv` — Expenditures (used by Form 460 Schedule D, Form 461, Form 496, etc.)
- (Verify during implementation if additional joining tables are needed: `cvr_e530_cd.csv`, `f501_502_cd.csv`)

**Files:**

- Modify: `src/lib/scorecard/calaccess-parser.ts` (add a second pass for IE data)
- Modify: `scripts/ingest-cal-access.ts` (wire the new pass)

- [ ] **Step 0: Acquire data files (user-driven, blocking)**

The implementer agent should STOP here and report `NEEDS_CONTEXT` with this message:

> "Task 8 needs Form 496 / expenditure CSV files from biglocalnews.org (CCDC California Campaign Finance project). Please log in to biglocalnews.org, locate the CCDC project, generate signed URLs for `s496_cd.csv` and `expn_cd.csv`, and paste them. I'll download them to `data/calaccess/raw/`."

The user provides URLs (same flow as the original PAC ingest). The controller (or a human follow-up) downloads with `curl` to `data/calaccess/raw/`. Once the files exist on disk, Task 8 resumes from Step 1.

- [ ] **Step 1: Inspect the new CSVs' headers**

```bash
head -1 data/calaccess/raw/s496_cd.csv
head -1 data/calaccess/raw/expn_cd.csv
wc -l data/calaccess/raw/s496_cd.csv data/calaccess/raw/expn_cd.csv
```

Expected output: the CSV headers + line counts. Capture the column names — the parser implementation depends on knowing exact columns. The CCDC documentation at `https://calaccess.californiacivicdata.org/documentation/calaccess-files/` describes each table.

Key columns we need (column names verified against the documented Cal-Access schema):

- `s496_cd.csv`: `FILING_ID` (the IE filing), `SUP_OPP_CD` ('S' or 'O'), `CAND_ID` or `CAND_NAML/F` (target candidate), `AMOUNT` (or `AMOUNT_SUM`), `EXP_DATE`
- `expn_cd.csv`: `FILING_ID`, `FORM_TYPE` (we want `F496` rows), `AMOUNT`, `SUP_OPP_CD`, `CAND_ID` or `CAND_NAML/F`

If the actual column names differ, adjust the parser in Step 2. If a column we need is missing (e.g., no target candidate ID), report DONE_WITH_CONCERNS and consult the user.

- [ ] **Step 2: Extend `src/lib/scorecard/calaccess-parser.ts`**

Add a new exported function below the existing `parseCalAccessForPac`:

```ts
export interface CalAccessIeBuckets {
  legislatorOpenStatesId: string;
  cycleYear: number;
  corporateIeSupportAmount: number;
  corporateIeAgainstOpponentAmount: number;
  corporateIeAgainstSelfAmount: number;
}

interface IeRecord {
  filingId: string;
  candidateName: string;
  candidateFilerId: string | null;
  amount: number;
  supportOrOppose: 'S' | 'O';
  expenditureDate: Date | null;
  spenderFilerId: string;
}

interface ParseCalAccessIeArgs {
  dataDir: string;
  legislators: ReadonlyArray<{
    id: string;
    openStatesId: string | null;
    fullName: string;
    state: string;
    chamber: 'SEN' | 'REP';
    district: number | null;
  }>;
  raceCandidatesByCycle: Map<
    number,
    ReadonlyArray<{
      externalCandidateId: string;
      candidateName: string;
      state: string;
      chamber: 'SEN' | 'REP';
      district: number | null;
      legislatorId: string | null;
    }>
  >;
  corporateSpenderFilerIds: ReadonlySet<string>; // from CommitteeClassification jurisdiction=CA category=CORPORATE|TRADE_ASSOCIATION
  cycles: ReadonlyArray<number>;
}

export async function parseCalAccessIe(args: ParseCalAccessIeArgs): Promise<CalAccessIeBuckets[]> {
  // Implementation:
  // 1. Stream s496_cd.csv (or expn_cd.csv filtered to FORM_TYPE='F496')
  // 2. For each row: identify spender (FILER_ID via FILING_ID lookup in cvr_campaign_disclosure_cd.csv from the original parse, OR via direct spender column if present)
  // 3. Skip if spender NOT in corporateSpenderFilerIds
  // 4. Identify target candidate (by CAND_ID or by name+state+chamber+district fuzzy match)
  // 5. Determine target's relationship to each legislator in our set:
  //    - target == legislator → support adds to corporateIeSupportAmount; oppose to corporateIeAgainstSelfAmount
  //    - target == one of legislator's opponents (from raceCandidatesByCycle) AND oppose → adds to corporateIeAgainstOpponentAmount
  // 6. Bucket by (legislator, cycle)
  // ...
  return []; // skeleton — implementation requires the column-name verification from Step 1
}
```

The skeleton above gives the SHAPE; the streaming + bucket logic mirrors the existing `parseCalAccess()` function pattern in the same file. Use `csv-parse` streaming as elsewhere.

**Implementation note:** the existing `parseCalAccess` already opens `cvr_campaign_disclosure_cd.csv` and `filer_filings_cd.csv` to resolve filer IDs. The IE pass should reuse those reads where possible to avoid two full passes over the same data — but if data dependencies make that hard, two passes is acceptable for v1.4.

- [ ] **Step 3: Wire into `scripts/ingest-cal-access.ts`**

Currently the script orchestrates the existing PAC parse + DB writes. After the existing per-legislator write block, add:

```ts
// v1.4: parse Form 496 IE data and update the same PacMoneyData rows
const raceCandidatesByCycle = new Map<number, RaceCandidate[]>();
for (const cycle of cycles) {
  const rows = await prisma.raceCandidate.findMany({
    where: { cycleYear: cycle, jurisdiction: 'CA' },
    select: {
      externalCandidateId: true,
      candidateName: true,
      state: true,
      chamber: true,
      district: true,
      legislatorId: true,
    },
  });
  raceCandidatesByCycle.set(cycle, rows);
}

const corpCmtes = await prisma.committeeClassification.findMany({
  where: { jurisdiction: 'CA', category: { in: ['CORPORATE', 'TRADE_ASSOCIATION'] } },
  select: { committeeId: true },
});
const corporateSpenderFilerIds = new Set(corpCmtes.map((c) => c.committeeId));

const ieBuckets = await parseCalAccessIe({
  dataDir: flags.dataDir,
  legislators: legislators.map((l) => ({
    id: l.id,
    openStatesId: l.openStatesId,
    fullName: l.fullName,
    state: l.state,
    chamber: l.chamber as 'SEN' | 'REP',
    district: l.district,
  })),
  raceCandidatesByCycle,
  corporateSpenderFilerIds,
  cycles,
});

for (const b of ieBuckets) {
  await prisma.pacMoneyData.upsert({
    where: {
      legislatorId_cycleYear_dataSource: {
        legislatorId: /* from openStatesId lookup */,
        cycleYear: b.cycleYear,
        dataSource: 'CAL_ACCESS_CCDC',
      },
    },
    create: { /* ... including the four IE fields ... */ },
    update: {
      corporateIeSupportAmount: b.corporateIeSupportAmount,
      corporateIeAgainstOpponentAmount: b.corporateIeAgainstOpponentAmount,
      corporateIeAgainstSelfAmount: b.corporateIeAgainstSelfAmount,
      // combinedCorporateRatio computed in the compute-scores step, not here
    },
  });
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 5: Dry-run smoke test**

```bash
npm run scorecard:ingest-ca-pac -- --ccdc-dir=./data/calaccess/raw --dry-run 2>&1 | tail -20
```

Expected: the script processes the IE pass and reports per-legislator IE bucket totals. If errors surface (column names wrong, type mismatches), capture and report DONE_WITH_CONCERNS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scorecard/calaccess-parser.ts scripts/ingest-cal-access.ts
git commit -m "feat(scorecard): CA Form 496 IE parser for v1.4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Compute pipeline + `ScoreCalibration` + version bump

**Files:**

- Modify: `scripts/compute-scores.ts`
- Modify: `src/lib/scorecard/scoring.ts` (bump `METHODOLOGY_VERSION`)

- [ ] **Step 1: Bump methodology version**

In `src/lib/scorecard/scoring.ts`, change:

```ts
export const METHODOLOGY_VERSION = 'v1.3';
```

to:

```ts
export const METHODOLOGY_VERSION = 'v1.4';
```

- [ ] **Step 2: Update the PAC achievement creation in `scripts/compute-scores.ts`**

Find the existing block that creates the PAC achievement (search for `corporate-pac-refusal`). The current code sets `actionTaken` to `ACTED_FOR` if the PAC % is below the threshold, else `ACTED_AGAINST`. Replace this with continuous-score logic:

```ts
import { pacScoreFromRatio } from '../src/lib/scorecard/scoring';

// Inside the per-legislator PAC achievement creation:
const ratio = Number(pac.combinedCorporateRatio ?? pac.corporatePacPercentage ?? 0);
const continuousScore = pacScoreFromRatio(ratio);
const actionTaken = continuousScore >= 0 ? 'ACTED_FOR' : 'ACTED_AGAINST';

await prisma.markerAchievement.upsert({
  where: { legislatorId_markerId: { legislatorId: leg.id, markerId: marker.id } },
  create: {
    legislatorId: leg.id,
    markerId: marker.id,
    achieved: continuousScore >= 0,
    actionTaken,
    achievementScore: continuousScore,
    evidenceType: leg.jurisdiction === 'CA' ? 'CAL_ACCESS_FILING' : 'FEC_FILING',
    evidenceSourceUrl: pac.dataSourceUrl ?? null,
    evidenceNotes: `cycle=${pac.cycleYear}, combined-corporate=${(ratio * 100).toFixed(
      2,
    )}%, continuous-score=${continuousScore.toFixed(2)}`,
    verifiedAt: new Date(),
    verifiedBy: 'pac-engine-v1.4',
  },
  update: {
    achieved: continuousScore >= 0,
    actionTaken,
    achievementScore: continuousScore,
    evidenceNotes: `cycle=${pac.cycleYear}, combined-corporate=${(ratio * 100).toFixed(
      2,
    )}%, continuous-score=${continuousScore.toFixed(2)}`,
    verifiedAt: new Date(),
    verifiedBy: 'pac-engine-v1.4',
  },
});
```

- [ ] **Step 3: Update `weightForAchievement` to read `achievementScore` for PAC markers**

In `src/lib/scorecard/scoring.ts`, the existing `weightForAchievement(a: AchievementForScoring)` function. Add a check at the top:

```ts
export function weightForAchievement(a: AchievementForScoring): number {
  // v1.4: PAC marker uses continuous achievementScore when present
  if ((a.evidenceType === 'FEC_FILING' || a.evidenceType === 'CAL_ACCESS_FILING') && a.achievementScore != null) {
    return a.achievementScore;
  }
  // Existing v1.3 weight table follows (unchanged)
  if (a.actionTaken !== 'ACTED_FOR' && a.actionTaken !== 'ACTED_AGAINST') return 0;
  const sign = a.actionTaken === 'ACTED_FOR' ? 1 : -1;
  if (a.evidenceType === 'COSPONSOR') {
    if (a.sponsorTier === 'AUTHOR' || a.sponsorTier === 'SPONSOR') return sign * 3;
    if (a.sponsorTier === 'PRINCIPAL_COAUTHOR' || a.sponsorTier === 'COAUTHOR') return sign * 2;
    return sign * 1;
  }
  return sign;
}
```

You'll also need to update the `AchievementForScoring` interface to include `achievementScore`:

```ts
export interface AchievementForScoring {
  markerId: string;
  achieved: boolean;
  actionTaken: AchievementStatus | null;
  evidenceType: 'COSPONSOR' | 'VOTE' | 'FEC_FILING' | 'CAL_ACCESS_FILING' | 'PUBLIC_STATEMENT';
  sponsorTier: 'AUTHOR' | 'PRINCIPAL_COAUTHOR' | 'COAUTHOR' | 'COSPONSOR' | 'SPONSOR' | null;
  achievementScore: number | null;
}
```

- [ ] **Step 4: Update `compute-scores.ts` achievement mapping to pass `achievementScore` through**

In `scripts/compute-scores.ts`, find the line mapping Prisma achievement rows to `AchievementForScoring`. Add `achievementScore: Number(a.achievementScore ?? 0) || null` to the map. Also expand the Prisma `select` to include `achievementScore: true`.

- [ ] **Step 5: Add `ScoreCalibration` write step**

At the END of `compute-scores.ts`'s `main()`, after the final `flushBatch()`:

```ts
// v1.4: compute ScoreCalibration anchors from the just-written score rows
console.log('[compute-scores] computing v1.4 percentile anchors...');
const allScores = await prisma.representativeScore.findMany({
  where: { methodologyVersion: 'v1.4', publishedAt: { not: null } },
  select: { legislatorId: true, score: true },
});
// Aggregate to per-legislator totals (sum across planks)
const totalsByLegislator = new Map<string, number>();
for (const s of allScores) {
  totalsByLegislator.set(s.legislatorId, (totalsByLegislator.get(s.legislatorId) ?? 0) + s.score);
}
const totals = [...totalsByLegislator.values()].sort((a, b) => a - b);
function percentile(p: number): number {
  if (totals.length === 0) return 0;
  const idx = Math.min(totals.length - 1, Math.max(0, Math.floor((p / 100) * totals.length)));
  return totals[idx];
}
const positiveAnchor = percentile(95);
const negativeAnchor = percentile(5);
await prisma.scoreCalibration.upsert({
  where: { methodologyVersion: 'v1.4' },
  create: {
    methodologyVersion: 'v1.4',
    positiveAnchor,
    negativeAnchor,
    computedFromCount: totalsByLegislator.size,
  },
  update: {
    positiveAnchor,
    negativeAnchor,
    computedFromCount: totalsByLegislator.size,
    computedAt: new Date(),
  },
});
console.log(
  `[compute-scores] v1.4 anchors: +100% = ${positiveAnchor} raw, -100% = ${negativeAnchor} raw (from ${totalsByLegislator.size} legislators)`,
);
```

- [ ] **Step 6: Typecheck + tests**

```bash
npm run typecheck 2>&1 | tail -5
npm run test:run 2>&1 | tail -3
```

Expected: clean. The existing 266 tests still pass. (We added pacScoreFromRatio + rawToPercent tests in Tasks 3+4.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/scorecard/scoring.ts scripts/compute-scores.ts
git commit -m "feat(scorecard): compute v1.4 — continuous PAC, achievementScore, ScoreCalibration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: PAC scoreboard column updates

**Files:**

- Modify: `src/app/(unprotected)/scorecard/pac/page.tsx`

- [ ] **Step 1: Update the Prisma `select` to pull IE columns**

In `src/app/(unprotected)/scorecard/pac/page.tsx`, find the `prisma.legislator.findMany` block. In the `pacData.select` add:

```ts
        corporateIeSupportAmount: true,
        corporateIeAgainstOpponentAmount: true,
        corporateIeAgainstSelfAmount: true,
        combinedCorporateRatio: true,
```

- [ ] **Step 2: Update the table columns**

Find the existing JSX (the `<table>` block). The columns currently are: Rank, Legislator, Party · State, Corporate PAC %, Total Receipts, Cycle, Source.

Replace with the v1.4 column order. Remove Source + Cycle entirely. Rename "Corporate PAC %" to "Direct corporate". Add new columns for Corp IE Supporting (prominent), Corp IE vs opponents, Corp IE attacking (muted italic), and "% Corporate Donations" (primary, bold).

```tsx
<table className="mt-6 w-full border-collapse text-sm">
  <thead>
    <tr className="border-b-2 border-gray-900 text-left">
      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wide text-gray-500">Rank</th>
      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wide text-gray-500">Legislator</th>
      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wide text-gray-500">Party · State</th>
      <th className="py-2 pr-4 text-right font-mono text-xs uppercase tracking-wide text-gray-500">Direct corporate</th>
      <th className="py-2 pr-4 text-right font-mono text-xs font-bold uppercase tracking-wide text-[#8B3A3A]">
        Corp IE Supporting
      </th>
      <th className="py-2 pr-4 text-right font-mono text-xs uppercase tracking-wide text-gray-500">
        Corp IE vs opponents
      </th>
      <th className="py-2 pr-4 text-right font-mono text-xs uppercase italic tracking-wide text-gray-400">
        Corp IE attacking
      </th>
      <th className="py-2 pr-4 text-right font-mono text-xs font-bold uppercase tracking-wide text-gray-900">
        % Corporate Donations
      </th>
      <th className="py-2 text-right font-mono text-xs uppercase tracking-wide text-gray-500">Total receipts</th>
    </tr>
  </thead>
  <tbody>
    {ranked.map((l, i) => {
      const ratio = Number(l.latest.combinedCorporateRatio ?? l.latest.corporatePacPercentage ?? 0);
      const pct = ratio;
      const passes = pct < CORPORATE_PAC_THRESHOLD;
      const corp = Number(l.latest.corporatePacAmount);
      const total = Number(l.latest.totalReceipts);
      const ieSupport = Number(l.latest.corporateIeSupportAmount ?? 0);
      const ieAgainstOpp = Number(l.latest.corporateIeAgainstOpponentAmount ?? 0);
      const ieAttacking = Number(l.latest.corporateIeAgainstSelfAmount ?? 0);
      const idForLink = l.bioguideId ?? l.openStatesId ?? l.id;
      const fmt$ = (n: number) => (n > 0 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—');
      return (
        <tr key={l.id} className="border-b border-gray-200">
          <td className="py-2 pr-4 font-mono text-xs text-gray-500">{i + 1}</td>
          <td className="py-2 pr-4">
            <Link
              href={`/scorecard/${encodeURIComponent(idForLink)}`}
              className="flex items-center gap-2 font-medium text-gray-900 hover:text-[#8B3A3A] hover:underline">
              <LegislatorAvatar fullName={l.fullName} photoUrl={l.photoUrl} size={32} />
              <span className="min-w-0">
                {l.fullName}
                {l.chamber === 'REP' && l.district != null && (
                  <span className="ml-1 text-xs text-gray-500">CD-{l.district}</span>
                )}
              </span>
            </Link>
          </td>
          <td className="py-2 pr-4 text-gray-700">
            {PARTY_LABEL[l.party] ?? l.party} · {l.state}
          </td>
          <td className="py-2 pr-4 text-right font-mono text-xs text-gray-600">{fmt$(corp)}</td>
          <td className="py-2 pr-4 text-right font-mono text-sm font-bold text-[#8B3A3A]">{fmt$(ieSupport)}</td>
          <td className="py-2 pr-4 text-right font-mono text-xs text-gray-600">{fmt$(ieAgainstOpp)}</td>
          <td className="py-2 pr-4 text-right font-mono text-xs italic text-gray-400">{fmt$(ieAttacking)}</td>
          <td className="py-2 pr-4 text-right">
            <span
              className={
                passes
                  ? 'font-serif text-base font-bold text-[#8B3A3A]'
                  : 'font-serif text-base font-bold text-gray-900'
              }>
              {(pct * 100).toFixed(1)}%
            </span>
            {passes && (
              <span className="ml-2 rounded bg-[#8B3A3A] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white">
                ✓
              </span>
            )}
          </td>
          <td className="py-2 text-right font-mono text-xs text-gray-600">{fmt$(total)}</td>
        </tr>
      );
    })}
  </tbody>
</table>
```

- [ ] **Step 3: Update the page header footnote**

Find the existing header `<p>` near the top. Update the methodology footnote text to reflect the cycle + sources:

```tsx
<p className="mt-2 text-xs text-gray-500">
  Current cycle data · sources: FEC + Cal-Access via CCDC. Combined % includes corporate IE spending FOR this legislator
  and AGAINST their same-cycle opponents. Corporate IE attacking is disclosed but not scored.
</p>
```

- [ ] **Step 4: Update the sort order**

Find the `.sort((a, b) => Number(a.latest.corporatePacPercentage) - Number(b.latest.corporatePacPercentage));` line. Replace with:

```ts
.sort((a, b) =>
  Number(a.latest.combinedCorporateRatio ?? a.latest.corporatePacPercentage ?? 0) -
  Number(b.latest.combinedCorporateRatio ?? b.latest.corporatePacPercentage ?? 0),
);
```

And update the `refuserCount` line similarly:

```ts
const refuserCount = ranked.filter(
  (l) => Number(l.latest.combinedCorporateRatio ?? l.latest.corporatePacPercentage ?? 0) < CORPORATE_PAC_THRESHOLD,
).length;
```

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck 2>&1 | tail -3
npm run build 2>&1 | tail -10
```

Expected: clean + build passes.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(unprotected)/scorecard/pac/page.tsx'
git commit -m "feat(scorecard): v1.4 PAC scoreboard — IE columns, % Corporate Donations primary

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Scorecard index page — percent display

**Files:**

- Modify: `src/app/(unprotected)/scorecard/page.tsx`
- Modify: `src/lib/scorecard/queries.ts` (to read `ScoreCalibration`)

- [ ] **Step 1: Add a helper in `queries.ts` to fetch the v1.4 calibration**

Append to `src/lib/scorecard/queries.ts`:

```ts
export interface ScoreCalibration {
  positiveAnchor: number;
  negativeAnchor: number;
}

export async function getScoreCalibration(version: string): Promise<ScoreCalibration | null> {
  const row = await prisma.scoreCalibration.findUnique({
    where: { methodologyVersion: version },
    select: { positiveAnchor: true, negativeAnchor: true },
  });
  if (!row) return null;
  return {
    positiveAnchor: Number(row.positiveAnchor),
    negativeAnchor: Number(row.negativeAnchor),
  };
}
```

- [ ] **Step 2: Use it on `/scorecard`**

In `src/app/(unprotected)/scorecard/page.tsx`:

```ts
import { rawToPercent } from '@/lib/scorecard/scoring';
import { getScoreCalibration } from '@/lib/scorecard/queries';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';

// In the page component, fetch calibration once:
const calibration = (await getScoreCalibration(METHODOLOGY_VERSION)) ?? { positiveAnchor: 25, negativeAnchor: -10 };
```

(Default fallback values are safe for early renders before the first compute runs.)

- [ ] **Step 3: Update the score-cell JSX**

Find the existing block that renders each legislator's score (currently just `+21` or similar). Replace with percent + raw:

```tsx
{
  (() => {
    const raw = computePublishedTotal(leg.scores);
    if (raw === null) return <span className="font-mono text-xs uppercase tracking-wide text-gray-500">Pending</span>;
    const percent = Math.round(rawToPercent(raw, calibration.positiveAnchor, calibration.negativeAnchor));
    const colorClass =
      percent > 50
        ? 'text-green-700'
        : percent > 0
        ? 'text-green-600'
        : percent === 0
        ? 'text-gray-500'
        : percent > -50
        ? 'text-red-500'
        : 'text-red-700';
    const sign = percent > 0 ? '+' : '';
    const rawSign = raw > 0 ? '+' : '';
    return (
      <>
        <p className={`font-serif text-2xl font-bold tabular-nums ${colorClass}`}>
          {sign}
          {percent}%
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-gray-500">
          raw {rawSign}
          {raw}
        </p>
      </>
    );
  })();
}
```

- [ ] **Step 4: Update sort order (highest percent first)**

The legislator list is sorted by some criterion already. If it's by raw score, the sort order doesn't change much (percent and raw correlate monotonically given fixed anchors), but the sort should now read from the same source — verify by checking the existing query in `queries.ts`. If a re-sort step is needed in the component, add it:

```ts
const sortedLegislators = [...legislators].sort((a, b) => {
  const aRaw = computePublishedTotal(a.scores) ?? -Infinity;
  const bRaw = computePublishedTotal(b.scores) ?? -Infinity;
  return bRaw - aRaw; // descending
});
```

Use `sortedLegislators` in the render loop.

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck 2>&1 | tail -3
npm run build 2>&1 | tail -10
```

Expected: clean + build passes.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(unprotected)/scorecard/page.tsx' src/lib/scorecard/queries.ts
git commit -m "feat(scorecard): v1.4 — anchored percent display on /scorecard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Legislator detail page — percent hero + PAC continuous

**Files:**

- Modify: `src/app/(unprotected)/scorecard/[id]/page.tsx`

- [ ] **Step 1: Add calibration import + fetch**

Top of file, add imports:

```ts
import { rawToPercent, METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
import { getScoreCalibration } from '@/lib/scorecard/queries';
```

In the component body, after the `findLegislatorByAnyId` call:

```ts
const calibration = (await getScoreCalibration(METHODOLOGY_VERSION)) ?? { positiveAnchor: 25, negativeAnchor: -10 };
```

- [ ] **Step 2: Replace the hero score**

Find the existing hero score JSX. It probably reads from `total` (a signed integer). Replace with:

```tsx
{
  (() => {
    if (total === null) {
      return (
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Score pending</p>
          <p className="mt-1 text-sm text-gray-600">Methodology v1.4 — no data yet</p>
        </div>
      );
    }
    const percent = Math.round(rawToPercent(total, calibration.positiveAnchor, calibration.negativeAnchor));
    const colorClass =
      percent > 50
        ? 'text-green-700'
        : percent > 0
        ? 'text-green-600'
        : percent === 0
        ? 'text-gray-500'
        : percent > -50
        ? 'text-red-500'
        : 'text-red-700';
    const sign = percent > 0 ? '+' : '';
    const rawSign = total > 0 ? '+' : '';
    // forCount/againstCount sums across planks
    const sumFor = legislator.scores.reduce((s, ps) => s + (ps.forCount ?? 0), 0);
    const sumAgainst = legislator.scores.reduce((s, ps) => s + (ps.againstCount ?? 0), 0);
    return (
      <div>
        <p className={`font-serif text-6xl font-bold tabular-nums ${colorClass}`}>
          {sign}
          {percent}%
        </p>
        <p className="mt-1 font-mono text-xs uppercase tracking-widest text-gray-500">
          Score · raw {rawSign}
          {total} · {sumFor} for · {sumAgainst} against
        </p>
      </div>
    );
  })();
}
```

- [ ] **Step 3: Update per-PAC-marker rendering**

Find the block that renders each plank's markers. For the PAC marker (slug = `corporate-pac-refusal` or `corporate-pac-refusal-ca`), display the continuous score + the underlying ratio.

Look up the achievement's `achievementScore` field (now selected via Prisma):

```tsx
{
  marker.slug.includes('corporate-pac-refusal')
    ? (() => {
        const score = Number(achievement?.achievementScore ?? 0);
        const ratio = parseFloat(achievement?.evidenceNotes?.match(/combined-corporate=(\d+\.\d+)%/)?.[1] ?? '0');
        const sign = score >= 0 ? '+' : '';
        return (
          <span className="font-mono text-xs text-gray-600">
            {sign}
            {score.toFixed(1)} · {ratio.toFixed(1)}% combined corporate donations
          </span>
        );
      })()
    : null;
}
```

(This renders next to the existing marker text. The existing v1.3 ✓/✗ icon logic stays; the new continuous text adds context.)

- [ ] **Step 4: Update the Prisma select to include `achievementScore`**

Find `findLegislatorByAnyId` in `src/lib/scorecard/queries.ts` and add `achievementScore: true` to the achievements select. If the query already returns achievements via `include`, no change needed (the field is automatically included). Verify:

```bash
grep -A 5 "achievements:" src/lib/scorecard/queries.ts | head -15
```

If the existing query uses `select` rather than full include, add `achievementScore: true` to the leaf select.

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck 2>&1 | tail -3
npm run build 2>&1 | tail -10
```

Expected: clean + passes.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(unprotected)/scorecard/[id]/page.tsx' src/lib/scorecard/queries.ts
git commit -m "feat(scorecard): v1.4 legislator detail — percent hero + continuous PAC marker

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Methodology doc rewrite for v1.4

**Files:**

- Modify: `docs/scorecard-methodology.md`

The v1.3 doc rewrite already established the structure; v1.4 extends with IE inclusion, continuous PAC, percent display, opponent linkage, and an explicit owning of "we don't count attacks on you as positive."

- [ ] **Step 1: Read the current doc**

```bash
cat docs/scorecard-methodology.md
```

Verify the 9-section structure from v1.3 (How we score, The basics, The weight table, The five planks, Two-tier markers, Corporate PAC money, What we don't yet score, Provisional bills, Methodology versions).

- [ ] **Step 2: Edit the doc**

Make the following edits to existing sections:

**`## The weight table`** — update to include the continuous PAC gradient:

After the existing weight table, add:

```markdown
### Corporate-PAC marker uses a continuous score, not a flat ±1

Most markers score +1 (acted for) or −1 (acted against). The corporate-PAC
marker on Plank 1 is different — it uses a gradient based on how much
corporate money flowed for the legislator's campaign:

| Combined corporate share | Marker score |
| ------------------------ | ------------ |
| 0%                       | +2.0         |
| 5%                       | +1.0         |
| 15%                      | 0 (neutral)  |
| 35%                      | −1.0         |
| 65%                      | −2.0         |
| 85%+                     | −3.0         |

Linear interpolation between anchors. A legislator at 1% corporate gets
+1.8; at 50% gets −1.5. The reward for being at "real zero" is bigger
than just meeting the 5% threshold, so legislators who genuinely refuse
corporate money get more credit than those who just barely qualify.
```

**`## Corporate PAC money`** — replace the section content with:

```markdown
The corporate-money signal counts both direct contributions to a candidate's
committee AND independent-expenditure spending by corporate-affiliated
super PACs. Under v1.4:

    Combined ratio = (direct corporate PAC $ + corporate IE supporting you + corporate IE against your opponents)
                     ──────────────────────────────────────────────────────────────────────────────────────────────
                     (total receipts + corporate IE supporting you + corporate IE against your opponents)

Where:

- **Direct corporate PAC $** — contributions from corporate-classified PACs to your campaign committee.
- **Corporate IE supporting you** — money corporate super PACs spent on ads / mail / digital FOR you.
- **Corporate IE against your opponents** — money corporate super PACs spent attacking the people running against you. Counts as money working on your behalf, even though you (legally) didn't ask for it.

The 5% threshold still applies — under 5% combined corporate ratio earns
the +1 partial-credit anchor on the gradient. At 0% combined, +2.

**What's NOT in the formula: corporate attacks ON you.** When a corporate
super PAC spends to defeat a legislator, that's not money working for
them — it's money working against them. We disclose those attacks in the
PAC scoreboard table (small italic column) because it's important
context, but we don't reward being attacked. Race competitiveness drives
a lot of attack spending in ways that don't track policy alignment.

### How we identify your opponents

For each cycle a legislator has run in, we count corporate IE against
any of these:

- **Past completed cycles**: every candidate who filed for the same seat in the same cycle, including primary challengers and the general-election opponent.
- **Active upcoming cycle**: every candidate who has filed paperwork to run for this seat in the next election.

### How we classify "corporate"

Federal: OpenSecrets' RealCode taxonomy maps thousands of PACs and IE
committees to industry sectors. Any committee tagged Business or
similar for-profit is treated as corporate. Trade associations are
bundled with corporate (they're the corporate sector's vehicle for
collective lobbying).

California: hand-curated `CommitteeClassification` table for top
Cal-Access filers. Same CORPORATE / LABOR / IDEOLOGICAL / TRADE
ASSOCIATION buckets. Same conservative-attribution rule — if we don't
have a classification, we don't count it as corporate.
```

**`## What we don't (yet) score`** — extend the existing bullet list with two new bullets:

```markdown
- **Real-time IE tracking.** Schedule E filings update at FEC daily, but our scorecard recomputes on a schedule (weekly during election cycles, less often outside). A super PAC drop today won't show up until the next compute.
- **Per-super-PAC drill-downs.** We aggregate corporate IE spending into one number per legislator. We don't yet show "which corporate super PAC spent the most on this senator" — that data is captured but not surfaced. Future feature.
```

**Add a new section AFTER `## Corporate PAC money`** called `## Scores as percentages`:

```markdown
## Scores as percentages

Each legislator's total is a signed integer (sum of weighted markers
across planks). We display it as a percentage from −100% to +100% to
make it easier to read at a glance:

- **+100%** = the 95th-percentile legislator's raw score
- **−100%** = the 5th-percentile legislator's raw score
- Everyone else scales linearly between

The percentile anchors are computed once per methodology version (from
the first published compute) and frozen until the next version. That
keeps percentages stable across the lifetime of a methodology version
even as new bills are added.

The raw integer score is always visible alongside the percentage for
anyone who wants the unscaled signal.
```

**`## Methodology versions`** — add the v1.4 row to the table:

```markdown
| v1.4 | 2026-05-14 | Super-PAC IE inclusion (corporate IE supporting you + corporate IE against your opponents), continuous PAC gradient, anchored percent display |
```

- [ ] **Step 3: Build to confirm doc renders**

```bash
npm run build 2>&1 | tail -10
```

The `/scorecard/methodology` route reads the file at request time; build doesn't need to do anything special.

- [ ] **Step 4: Commit**

```bash
git add docs/scorecard-methodology.md
git commit -m "docs(scorecard): methodology v1.4 — IE inclusion, continuous PAC, percent display

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Push branch + open PR + preview verify

**Files:**

- No code changes.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin chore/scorecard-v1.4
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --title "feat(scorecard): v1.4 — super-PAC IE inclusion, continuous PAC, percent display" --body "$(cat <<'EOF'
## Summary
- Methodology v1.3 → v1.4
- Corporate-money ratio now includes super-PAC independent expenditures (FEC Schedule E + Cal-Access Form 496)
- Corporate IE supporting you + corporate IE against your opponents count toward the ratio; attacks ON you are disclosed in the PAC scoreboard but NOT scored
- Continuous PAC gradient replaces binary ±1: 0% combined → +2, 5% → +1, 15% → 0, 35% → −1, 65% → −2, 85%+ → −3
- Scores now display as anchored percentages (−100% to +100%) with raw score alongside
- PAC scoreboard column updates: "% Corporate Donations" replaces "Corporate PAC %"; Corp IE Supporting prominent; Source + Cycle columns hidden

## Spec
[docs/superpowers/specs/2026-05-14-scorecard-v1.4-design.md](docs/superpowers/specs/2026-05-14-scorecard-v1.4-design.md)

## Test plan
- [x] Local: \`npm run typecheck\` clean
- [x] Local: \`npm run build\` passes
- [x] Local: \`npm run test:run\` — 266 pass (246 baseline + 11 pacScoreFromRatio + 9 rawToPercent)
- [ ] Vercel preview: \`/scorecard\` renders percent + raw
- [ ] Vercel preview: \`/scorecard/[id]\` hero is percent; PAC marker shows continuous score
- [ ] Vercel preview: \`/scorecard/pac\` shows v1.4 columns (Corp IE Supporting prominent; Source + Cycle hidden)
- [ ] Vercel preview: \`/scorecard/methodology\` reflects v1.4 doc rewrite
- [ ] **Post-merge** (Task 15): run ingest pipeline + spot-check 5 legislators:
  - Sherrod Brown (heavy IE against him in 2024)
  - Jon Tester (heavy IE both ways in 2024)
  - AOC (heavy corporate-IE attacks; low direct corp PAC)
  - John Kennedy (heavy direct corp PAC + presumably corp-IE aligned)
  - Ash Kalra (CalCare author; CA pipeline sanity)

## Rollback
\`git revert <merge-sha>\` — v1.3 score rows persist in DB; reads filter back to v1.3 and display reverts to integer scores. RaceCandidate / ScoreCalibration / CommitteeClassification rows are harmless data; safe to leave.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch Vercel preview build**

Wait for the preview URL to appear on the PR. Smoke-test the four UI surfaces in the checklist. If anything regresses, iterate on the branch.

---

## Task 15: Merge + ingest + recompute + spot-check

**Files:**

- No code changes.

- [ ] **Step 1: Merge**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull origin main
```

Wait for Vercel production deploy.

- [ ] **Step 2: Bulk-seed `CommitteeClassification` from OpenSecrets**

```bash
npm run scorecard:ingest-opensecrets-classifications 2>&1 | tail -5
```

Expected: thousands of rows upserted. If the OpenSecrets URL has changed, fall back to manual CSV download (see Task 5 Step 3 note).

- [ ] **Step 3: Populate `RaceCandidate` for relevant cycles**

```bash
npm run scorecard:ingest-race-candidates -- --cycles=2022,2024,2026,2028 2>&1 | tail -10
```

Expected: hundreds to thousands of FEC candidates upserted. CA is stubbed in Task 6 — federal-only is the baseline.

- [ ] **Step 4: Run Federal Schedule E ingest**

```bash
npm run scorecard:ingest-fec 2>&1 | tail -10
```

Expected: per-legislator IE buckets populated. Substantial run time (~5-15 min) since each legislator + opponent needs Schedule E pulls.

- [ ] **Step 5: Run CA Form 496 ingest (if Task 8 data files were acquired)**

```bash
npm run scorecard:ingest-ca-pac -- --ccdc-dir=./data/calaccess/raw 2>&1 | tail -10
```

Expected: CA legislators' IE buckets populated. Skip if Task 8 was deferred.

- [ ] **Step 6: Run compute**

```bash
npm run scorecard:compute -- --auto-verify --publish 2>&1 | tail -10
```

Expected:

- `pac achievements: wrote N, M pass the <5% threshold`
- `summary: X score row(s) written · Y positive · Z negative`
- `v1.4 anchors: +100% = <pos> raw, -100% = <neg> raw (from N legislators)`

- [ ] **Step 7: Spot-check 5 legislators**

Open `https://op-pink.vercel.app/scorecard` and click into each legislator:

| Legislator    | Open URL                                       | Expected                                                                                 |
| ------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Sherrod Brown | `/scorecard/B000944`                           | Direct corp % low; "Corp IE attacking" massive (disclosure column); total moves modestly |
| Jon Tester    | `/scorecard/T000464`                           | "% Corporate Donations" jumps from v1.3 — corporate IE against Sheehy counts FOR him     |
| AOC           | `/scorecard/O000172`                           | Direct corp % near zero; "Corp IE attacking" prominent (display-only)                    |
| John Kennedy  | `/scorecard/K000393`                           | Combined % rises above the 0.97% direct (IE inclusion)                                   |
| Ash Kalra     | search by name on `/scorecard?jurisdiction=CA` | CA pipeline sanity if Step 5 ran                                                         |

If any score looks wildly wrong (e.g., a known progressive author has a deeply negative total, or the percent displays as NaN), pause and investigate before declaring done.

- [ ] **Step 8: Done**

The v1.4 ship is complete. Update the team / mark the plan checklist closed.

---

## Out of scope (intentional)

- Real-time IE ingest cron. Manual recompute is sufficient for v1.4.
- Per-super-PAC drill-down UI. Data captured at aggregate; drill-down is future.
- Compare-two-legislators view.
- "Primary" / "GOP alt" badge re-introduction.
- Sponsor-tier weighting refinements.
- Per-plank standalone scoreboards.
- React 18 → 19 migration.

## Rollback

If anything in the recompute produces obviously wrong scores: `git revert <merge-sha>`, push to main, Vercel redeploys. v1.3 rows persist in DB. Read filter reverts. `RaceCandidate`, `ScoreCalibration`, IE columns on `PacMoneyData` all persist as harmless additive data.
