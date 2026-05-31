// v1.8.8 (audit #B) — Single-pass reclass of CORPORATE rows that were
// auto-tagged by the bare-name regex pack (`\bINC\b`, `\bLLC\b`, `\bCORP\b`,
// `\bDEFENSE\b`, `/UNITED ?HEALTH/`) but lack any FEC `connected_organization_name`.
//
// Real corporate PACs (separate-segregated funds, trade-assoc PACs) ALWAYS
// have a non-empty connected_org — that affiliation is what makes them a
// corporate PAC. Super PACs (committee_type O/I/V/W/U/E) almost never do.
// Pre-v1.8.8, ~80 super PACs (~$112M of IE_OPPOSE) were sitting in CORPORATE
// because their names ended in INC / LLC / CORP / DEFENSE.
//
// This script:
//   1. Loads every PacClassification WHERE class='CORPORATE' AND finalClass
//      IS NULL AND ( (connectedOrg IS NULL OR connectedOrg IN ('NONE','')) OR
//      reason matches one of the now-tightened patterns ('DEFENSE',
//      'UNITED ?HEALTH') — needed to catch e.g. DITCH FUND whose connectedOrg
//      "DEMOCRATIC DEFENSE FUND" hit the bare `\bDEFENSE\b` rule).
//      Human locks (finalClass set) are sacred.
//   2. Re-runs the v1.8.8 autoClassify on a PacRow built from the stored row.
//   3. If the new class differs from CORPORATE, stages the flip.
//   4. Writes the full before/after breakdown to
//      `data/v188-reclass-report.json` and prints the summary.
//
// Modes:
//   --dry-run   (default if neither flag passed)   — report only, no writes
//   --apply                                          — write the updates
//
// Usage:
//   npx tsx scripts/reclassify-corporate-regex-v188.ts --dry-run
//   npx tsx scripts/reclassify-corporate-regex-v188.ts --apply

import './load-env';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { autoClassify, type PacRow } from './spike-pac-candidates';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const VALID = new Set([
  'CORPORATE',
  'DARK_MONEY',
  'FOREIGN_POLICY',
  'ACTIVIST',
  'LABOR',
  'LEADERSHIP',
  'IDEOLOGICAL',
  'CONDUIT',
  'PARTY',
  'UNKNOWN',
]);

interface Flip {
  committeeId: string;
  name: string;
  oldClass: 'CORPORATE';
  oldReason: string | null;
  newClass: string;
  newReason: string;
  committeeType: string | null;
  orgType: string | null;
  connectedOrg: string | null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run') || !apply;
  if (apply && args.includes('--dry-run')) {
    console.error('[v188-reclass] cannot pass both --dry-run and --apply');
    process.exit(1);
  }

  console.log(`[v188-reclass] mode = ${apply ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);

  // Pull every CORPORATE row that is a candidate for v1.8.8 reclassification:
  //   - Primary cohort: connectedOrg is empty / NULL / "NONE". The bare-name
  //     regex pack mis-tagged ~80 super PACs here (AMERICA FIRST ACTION INC etc.)
  //   - Secondary cohort: connectedOrg is populated BUT the prior reason
  //     references one of the patterns we tightened in v1.8.8 (`/DEFENSE/`,
  //     `/UNITED ?HEALTH/`). E.g., DITCH FUND has connectedOrg
  //     "DEMOCRATIC DEFENSE FUND" but only landed in CORPORATE because of
  //     `\bDEFENSE\b` — now tightened to defense-industry only.
  // finalClass is a human lock — never touch those.
  const noConnectedOrgFilter = {
    OR: [
      { connectedOrg: null },
      { connectedOrg: '' },
      { connectedOrg: 'NONE' },
      { connectedOrg: 'None' },
      { connectedOrg: 'none' },
    ],
  };
  const tightenedReasonFilter = {
    OR: [
      { reason: { contains: 'DEFENSE' } },
      { reason: { contains: 'UNITED ?HEALTH' } },
    ],
  };
  const candidates = await prisma.pacClassification.findMany({
    where: {
      class: 'CORPORATE',
      finalClass: null,
      OR: [noConnectedOrgFilter, tightenedReasonFilter],
    },
    select: {
      committeeId: true,
      name: true,
      committeeType: true,
      orgType: true,
      connectedOrg: true,
      reason: true,
      source: true,
    },
  });

  console.log(`[v188-reclass] ${candidates.length} CORPORATE rows with no connectedOrg to re-evaluate`);

  // Pull contribution-volume totals so we can report dollar impact per flip.
  const ids = candidates.map((c: { committeeId: string }) => c.committeeId);
  const volumes = await prisma.$queryRaw<Array<{ donorCommitteeId: string; total: string }>>`
    SELECT "donorCommitteeId", COALESCE(SUM(amount::numeric), 0)::text AS total
    FROM "PacContribution"
    WHERE "donorCommitteeId" = ANY(${ids})
    GROUP BY "donorCommitteeId"
  `;
  const volumeMap = new Map<string, number>(
    volumes.map((v: { donorCommitteeId: string; total: string }) => [v.donorCommitteeId, Number(v.total)]),
  );

  const flips: Flip[] = [];
  const kept: Array<{ committeeId: string; name: string; reason: string }> = [];
  const newClassCounts: Record<string, number> = {};
  const newClassDollars: Record<string, number> = {};
  function bumpDollars(cls: string, amt: number): void {
    newClassDollars[cls] = (newClassDollars[cls] ?? 0) + amt;
  }

  for (const row of candidates) {
    // Build a synthetic PacRow with the four fields autoClassify reads.
    // Numeric/IE volumes default to 0 — they only matter for ordering in the
    // spike script, not for classification.
    const pacRow: PacRow = {
      committee_id: row.committeeId,
      name: row.name,
      committee_type: row.committeeType ?? '',
      total_receipts: 0,
      contribs_to_others: 0,
      ind_exp: 0,
      influence_volume: 0,
      org_type: row.orgType ?? '',
      connected_org: row.connectedOrg ?? '',
    };
    const result = autoClassify(pacRow);
    if (!VALID.has(result.proposed)) {
      console.warn(`[v188-reclass] WARN: classifier returned unknown class ${result.proposed} for ${row.committeeId}`);
      continue;
    }
    const dollars = volumeMap.get(row.committeeId) ?? 0;
    if (result.proposed === 'CORPORATE') {
      kept.push({ committeeId: row.committeeId, name: row.name, reason: result.reason });
      continue;
    }
    flips.push({
      committeeId: row.committeeId,
      name: row.name,
      oldClass: 'CORPORATE',
      oldReason: row.reason,
      newClass: result.proposed,
      newReason: `v1.8.8-regate: ${result.reason}`,
      committeeType: row.committeeType,
      orgType: row.orgType,
      connectedOrg: row.connectedOrg,
    });
    newClassCounts[result.proposed] = (newClassCounts[result.proposed] ?? 0) + 1;
    bumpDollars(result.proposed, dollars);
  }

  const totalDollars = flips.reduce((s, f) => s + (volumeMap.get(f.committeeId) ?? 0), 0);

  console.log(`\n[v188-reclass] Re-evaluation summary:`);
  console.log(`  CORPORATE (unchanged, still hits a non-gated rule): ${kept.length}`);
  console.log(`  Will flip away from CORPORATE: ${flips.length}`);
  console.log(`  Total contributions across flipped committees: $${Math.round(totalDollars).toLocaleString()}`);
  console.log(`\n  Breakdown of new class assignments:`);
  const sortedClasses = Object.keys(newClassCounts).sort();
  for (const cls of sortedClasses) {
    console.log(
      `    ${cls.padEnd(14)} ${String(newClassCounts[cls]).padStart(4)} committees   $${Math.round(
        newClassDollars[cls],
      ).toLocaleString()}`,
    );
  }

  // Marquee reference cases from the audit, for spot-check visibility.
  const REFERENCE = ['C00637512', 'C00798116', 'C00540203', 'C00688739', 'C00864926', 'C90013426', 'C00878744'];
  console.log(`\n  Reference cases (audit-cited):`);
  for (const id of REFERENCE) {
    const flip = flips.find((f) => f.committeeId === id);
    const keep = kept.find((k) => k.committeeId === id);
    if (flip) {
      console.log(
        `    ${id}  ${flip.name.slice(0, 50).padEnd(50)}  CORPORATE -> ${flip.newClass.padEnd(12)}  ${flip.newReason}`,
      );
    } else if (keep) {
      console.log(`    ${id}  ${keep.name.slice(0, 50).padEnd(50)}  STAYS CORPORATE                ${keep.reason}`);
    } else {
      console.log(
        `    ${id}  (not in CORPORATE+no-connectedOrg candidate set — already non-CORPORATE or has connectedOrg)`,
      );
    }
  }

  // Write the full report to disk.
  const reportPath = path.join(process.cwd(), 'data', 'v188-reclass-report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    candidatesScanned: candidates.length,
    flippedCount: flips.length,
    keptCorporateCount: kept.length,
    totalDollarsReclassified: Math.round(totalDollars),
    newClassCounts,
    newClassDollars: Object.fromEntries(Object.entries(newClassDollars).map(([k, v]) => [k, Math.round(v)])),
    flips,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[v188-reclass] wrote report to ${reportPath}`);

  if (dryRun) {
    console.log(`[v188-reclass] DRY RUN — no DB writes. Re-run with --apply to commit.`);
    await prisma.$disconnect();
    return;
  }

  // APPLY: stage updates one by one. We do not batch because we want per-row
  // reason strings (each carries the regex hit that fired in the new class).
  let done = 0;
  for (const f of flips) {
    await prisma.pacClassification.update({
      where: { committeeId: f.committeeId },
      data: {
        class: f.newClass as
          | 'CORPORATE'
          | 'DARK_MONEY'
          | 'FOREIGN_POLICY'
          | 'ACTIVIST'
          | 'LABOR'
          | 'LEADERSHIP'
          | 'IDEOLOGICAL'
          | 'CONDUIT'
          | 'PARTY'
          | 'UNKNOWN',
        reason: f.newReason.slice(0, 500),
        source: 'auto',
      },
    });
    done += 1;
    if (done % 25 === 0) console.log(`[v188-reclass] ... applied ${done}/${flips.length}`);
  }
  console.log(`[v188-reclass] ✓ applied ${done} reclassifications`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
