// v1.8.x — Apply targeted DARK_MONEY → ACTIVIST/LABOR/IDEOLOGICAL reclassifications.
//
// Sibling of apply-unknown-reclassify.ts. Same file shape, but the WHERE-guard
// is class='DARK_MONEY' instead of class='UNKNOWN'. Use when an investigation
// (e.g., Markey spot-check) finds a regex / vague-name auto-classification
// swept a single-issue activist or labor super PAC into DARK_MONEY. Keeps
// human/inline rows safe — won't overwrite anything already finalClass-locked
// or sourced from a more authoritative pass.
//
// Conservative rule (per methodology v1.8.x reclassification protocol):
//   - Only flip DARK_MONEY → ACTIVIST when (a) committee name clearly indicates
//     a specific cause, (b) connectedOrg or top donors are a known single-issue
//     parent (Sierra Club, LCV, NRDC, Environment America, etc.), AND (c) the
//     PAC is grassroots / cause-funded, not billionaire-backed.
//   - When in doubt, leave alone and surface in the investigation report.
//
// Usage:
//   npx tsx scripts/apply-darkmoney-reclassify.ts data/markey-darkmoney-reclassify.json
//   npx tsx scripts/apply-darkmoney-reclassify.ts --dry-run data/markey-darkmoney-reclassify.json

import './load-env';
import fs from 'fs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('Usage: apply-darkmoney-reclassify.ts [--dry-run] <file.json> [...]');
    process.exit(1);
  }

  const merged: Record<string, { class: string; reason: string }> = {};
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, { class: string; reason: string }>;
    Object.assign(merged, data);
    console.log(`[apply-dm] loaded ${Object.keys(data).length} from ${f}`);
  }
  const ids = Object.keys(merged);
  console.log(`[apply-dm] ${ids.length} total committee reclassifications to apply`);

  const bad = ids.filter((id) => !VALID.has(merged[id].class));
  if (bad.length > 0) {
    console.error(`[apply-dm] INVALID class on: ${bad.slice(0, 10).join(', ')}`);
    process.exit(1);
  }

  // Only touch rows currently DARK_MONEY (protects already-curated rows of
  // other classes). Also skip rows with finalClass set — that's a human lock.
  const existing = await prisma.pacClassification.findMany({
    where: { committeeId: { in: ids } },
    select: { committeeId: true, class: true, finalClass: true, name: true },
  });
  const existingMap = new Map(existing.map((r) => [r.committeeId, r]));
  const counts: Record<string, number> = {};
  let willUpdate = 0;
  let skippedNotDM = 0;
  let skippedFinalLocked = 0;
  let skippedMissing = 0;
  for (const id of ids) {
    const cur = existingMap.get(id);
    if (cur === undefined) {
      skippedMissing += 1;
      continue;
    }
    if (cur.finalClass) {
      skippedFinalLocked += 1;
      continue;
    }
    if (cur.class !== 'DARK_MONEY') {
      skippedNotDM += 1;
      continue;
    }
    counts[merged[id].class] = (counts[merged[id].class] ?? 0) + 1;
    willUpdate += 1;
    console.log(`  [will flip] ${id} ${cur.name}: DARK_MONEY -> ${merged[id].class}`);
  }
  console.log(
    `[apply-dm] will update ${willUpdate} (skip ${skippedNotDM} non-DARK_MONEY, ${skippedFinalLocked} finalClass-locked, ${skippedMissing} missing)`,
  );
  console.log(`[apply-dm] breakdown: ${JSON.stringify(counts)}`);

  if (dryRun) {
    console.log('[apply-dm] DRY RUN — no writes');
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const id of ids) {
    const cur = existingMap.get(id);
    if (!cur || cur.finalClass || cur.class !== 'DARK_MONEY') continue;
    await prisma.pacClassification.update({
      where: { committeeId: id },
      data: {
        class: merged[id].class as
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
        reason: merged[id].reason.slice(0, 500),
        source: 'inline',
      },
    });
    done += 1;
  }
  console.log(`[apply-dm] ✓ updated ${done} committees`);

  // Dollar impact across all legislators
  const impact = await prisma.$queryRaw<Array<{ total: string }>>`
    SELECT COALESCE(SUM(k.amount::numeric), 0)::text AS total
    FROM "PacContribution" k
    WHERE k."donorCommitteeId" = ANY(${ids})
  `;
  console.log(
    `[apply-dm] reclassified committees carry $${Math.round(Number(impact[0].total)).toLocaleString()} of contributions across all legislators`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
