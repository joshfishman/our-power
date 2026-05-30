// v1.8.7 — Audit #29: apply UNKNOWN catalog batch reclassifications.
//
// Sibling of scripts/apply-unknown-reclassify.ts. Reads
// data/unknown-batch-202605.json (or any path passed in) and updates
// PacClassification, ONLY for rows currently class='UNKNOWN' AND
// finalClass IS NULL (never overwrite a human-locked row).
//
// Usage:
//   npx tsx scripts/apply-unknown-batch.ts --dry-run data/unknown-batch-202605.json
//   npx tsx scripts/apply-unknown-batch.ts data/unknown-batch-202605.json

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

type Entry = { class: string; reason: string };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('Usage: apply-unknown-batch.ts [--dry-run] <file.json> [...]');
    process.exit(1);
  }

  const merged: Record<string, Entry> = {};
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, Entry>;
    Object.assign(merged, data);
    console.log(`[apply] loaded ${Object.keys(data).length} from ${f}`);
  }
  const ids = Object.keys(merged);
  console.log(`[apply] ${ids.length} total committee classifications to apply`);

  const bad = ids.filter((id) => !VALID.has(merged[id].class));
  if (bad.length > 0) {
    console.error(`[apply] INVALID class on: ${bad.slice(0, 10).join(', ')}`);
    process.exit(1);
  }

  // Only touch rows currently UNKNOWN AND not finalClass-locked.
  const existing = await prisma.pacClassification.findMany({
    where: { committeeId: { in: ids } },
    select: { committeeId: true, class: true, finalClass: true },
  });
  const existingMap = new Map(existing.map((r) => [r.committeeId, r]));
  const counts: Record<string, number> = {};
  let willUpdate = 0;
  let skippedNotUnknown = 0;
  let skippedFinalClass = 0;
  let skippedMissing = 0;
  let skippedNoop = 0;
  const updateIds: string[] = [];
  for (const id of ids) {
    const cur = existingMap.get(id);
    if (cur === undefined) {
      skippedMissing += 1;
      continue;
    }
    if (cur.finalClass !== null && cur.finalClass !== undefined) {
      skippedFinalClass += 1;
      continue;
    }
    if (cur.class !== 'UNKNOWN') {
      skippedNotUnknown += 1;
      continue;
    }
    if (merged[id].class === 'UNKNOWN') {
      skippedNoop += 1;
      continue;
    }
    counts[merged[id].class] = (counts[merged[id].class] ?? 0) + 1;
    willUpdate += 1;
    updateIds.push(id);
  }
  console.log(
    `[apply] will update ${willUpdate} (skip ${skippedNotUnknown} non-UNKNOWN, ${skippedFinalClass} finalClass-locked, ${skippedMissing} missing, ${skippedNoop} no-op UNKNOWN→UNKNOWN)`,
  );
  console.log(`[apply] breakdown: ${JSON.stringify(counts)}`);

  // Dollar impact preview (counts-against kinds, DIRECT+IE_SUPPORT)
  if (updateIds.length > 0) {
    const impact = await prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(k.amount::numeric), 0)::text AS total
      FROM "PacContribution" k
      WHERE k."donorCommitteeId" = ANY(${updateIds})
        AND k.kind IN ('DIRECT', 'IE_SUPPORT')
    `;
    console.log(
      `[apply] reclassifying committees carry $${Math.round(Number(impact[0].total)).toLocaleString()} of counts-against contributions`,
    );
  }

  if (dryRun) {
    console.log('[apply] DRY RUN — no writes');
    await prisma.$disconnect();
    return;
  }

  // Wrap all updates in a single transaction so a mid-loop kill leaves the DB clean.
  // v1.8.7 audit-revision: added per audit-#29 reviewer follow-up (APPROVE-WITH-CHANGES).
  const ops = updateIds.map((id) =>
    prisma.pacClassification.update({
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
    }),
  );
  const results = await prisma.$transaction(ops);
  console.log(`[apply] ✓ updated ${results.length} committees (transaction committed)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
