// v1.7.x — Apply inline reclassifications of UNKNOWN committees.
//
// Reads one or more JSON files of { committeeId: { class, reason } } and
// updates PacClassification, but ONLY for rows currently class='UNKNOWN'
// (so we never overwrite a human-reviewed or already-classified row by
// accident). These are hand/LLM classifications of the ~775 named UNKNOWN
// committees that the regex confidence-gate left unclassified — money we
// "can't just ignore."
//
// Usage:
//   npx tsx scripts/apply-unknown-reclassify.ts data/unknown-reclassify-batch1.json [batch2.json ...]
//   npx tsx scripts/apply-unknown-reclassify.ts --dry-run data/unknown-reclassify-batch1.json

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
    console.error('Usage: apply-unknown-reclassify.ts [--dry-run] <file.json> [...]');
    process.exit(1);
  }

  const merged: Record<string, { class: string; reason: string }> = {};
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, { class: string; reason: string }>;
    Object.assign(merged, data);
    console.log(`[apply] loaded ${Object.keys(data).length} from ${f}`);
  }
  const ids = Object.keys(merged);
  console.log(`[apply] ${ids.length} total committee classifications to apply`);

  // Validate classes
  const bad = ids.filter((id) => !VALID.has(merged[id].class));
  if (bad.length > 0) {
    console.error(`[apply] INVALID class on: ${bad.slice(0, 10).join(', ')}`);
    process.exit(1);
  }

  // Only touch rows currently UNKNOWN (protect already-classified / human rows).
  const existing = await prisma.pacClassification.findMany({
    where: { committeeId: { in: ids } },
    select: { committeeId: true, class: true },
  });
  const existingMap = new Map(existing.map((r) => [r.committeeId, r.class]));
  const counts: Record<string, number> = {};
  let willUpdate = 0;
  let skippedNotUnknown = 0;
  let skippedMissing = 0;
  for (const id of ids) {
    const cur = existingMap.get(id);
    if (cur === undefined) {
      skippedMissing += 1;
      continue;
    }
    if (cur !== 'UNKNOWN') {
      skippedNotUnknown += 1;
      continue;
    }
    counts[merged[id].class] = (counts[merged[id].class] ?? 0) + 1;
    willUpdate += 1;
  }
  console.log(`[apply] will update ${willUpdate} (skip ${skippedNotUnknown} non-UNKNOWN, ${skippedMissing} missing)`);
  console.log(`[apply] breakdown: ${JSON.stringify(counts)}`);

  if (dryRun) {
    console.log('[apply] DRY RUN — no writes');
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const id of ids) {
    const cur = existingMap.get(id);
    if (cur !== 'UNKNOWN') continue;
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
  console.log(`[apply] ✓ updated ${done} committees`);

  // Dollar impact: how much UNKNOWN money did we just reclassify?
  const impact = await prisma.$queryRaw<Array<{ total: string }>>`
    SELECT COALESCE(SUM(k.amount::numeric), 0)::text AS total
    FROM "PacContribution" k
    WHERE k."donorCommitteeId" = ANY(${ids})
  `;
  console.log(
    `[apply] reclassified committees carry $${Math.round(Number(impact[0].total)).toLocaleString()} of contributions`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
