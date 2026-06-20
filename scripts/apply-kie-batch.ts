// v1.9.7 — apply KIE-batch committee classifications with a confidence gate.
//
// Reads data/committee-proposals-batch.json (committeeId -> {class, reason}),
// where reason carries a "conf=0.NN" marker. Applies ONLY rows currently
// class='UNKNOWN' AND finalClass IS NULL (never overwrites a human-locked or
// already-classified row), AND only when conf >= --min-conf (default 0.8).
//
// Writes are issued sequentially (NOT one big $transaction) — the Supabase
// pooler aborts a multi-hundred-statement transaction at its ~5s timeout.
//
// Usage:
//   npx tsx scripts/apply-kie-batch.ts --dry-run            # preview
//   npx tsx scripts/apply-kie-batch.ts --min-conf=0.8       # apply >=0.8
//   npx tsx scripts/apply-kie-batch.ts                      # apply >=0.8 (default)

import './load-env';
import fs from 'fs';
import path from 'path';
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
const COUNTS_AGAINST = new Set(['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY', 'LEADERSHIP']);

type Entry = { class: string; reason: string };

function confOf(reason: string): number {
  const m = (reason || '').match(/conf=([0-9.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const minConfArg = args.find((a) => a.startsWith('--min-conf='));
  const minConf = minConfArg ? parseFloat(minConfArg.split('=')[1]) : 0.8;
  const fileArg = args.filter((a) => !a.startsWith('--'))[0];
  const file = fileArg ?? path.join('data', 'committee-proposals-batch.json');

  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, Entry>;
  const ids = Object.keys(data);
  console.log(`[kie-apply] loaded ${ids.length} proposals from ${file}; min-conf=${minConf}`);

  const bad = ids.filter((id) => !VALID.has(data[id].class));
  if (bad.length > 0) {
    console.error(`[kie-apply] INVALID class on: ${bad.slice(0, 10).join(', ')}`);
    process.exit(1);
  }

  const existing = await prisma.pacClassification.findMany({
    where: { committeeId: { in: ids } },
    select: { committeeId: true, class: true, finalClass: true },
  });
  const existingMap = new Map(existing.map((r) => [r.committeeId, r]));

  const counts: Record<string, number> = {};
  const updateIds: string[] = [];
  let skipLowConf = 0;
  let skipNoop = 0;
  let skipLocked = 0;
  let skipNotUnknown = 0;
  let skipMissing = 0;
  for (const id of ids) {
    const cur = existingMap.get(id);
    if (cur === undefined) {
      skipMissing += 1;
      continue;
    }
    if (cur.finalClass != null) {
      skipLocked += 1;
      continue;
    }
    if (cur.class !== 'UNKNOWN') {
      skipNotUnknown += 1;
      continue;
    }
    if (data[id].class === 'UNKNOWN') {
      skipNoop += 1;
      continue;
    }
    if (confOf(data[id].reason) < minConf) {
      skipLowConf += 1;
      continue;
    }
    counts[data[id].class] = (counts[data[id].class] ?? 0) + 1;
    updateIds.push(id);
  }
  console.log(
    `[kie-apply] will update ${updateIds.length} (skip ${skipLowConf} below-conf, ${skipNotUnknown} non-UNKNOWN, ${skipLocked} locked, ${skipMissing} missing, ${skipNoop} no-op)`,
  );
  console.log(`[kie-apply] breakdown: ${JSON.stringify(counts)}`);

  const caIds = updateIds.filter((id) => COUNTS_AGAINST.has(data[id].class));
  if (caIds.length > 0) {
    const impact = await prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(k.amount::numeric), 0)::text AS total
      FROM "PacContribution" k
      WHERE k."donorCommitteeId" = ANY(${caIds})
        AND k.kind IN ('DIRECT', 'JFC_PASS_THROUGH', 'LEADERSHIP_PASS_THROUGH', 'IE_SUPPORT', 'IE_OPPOSE_BENEFICIARY')
    `;
    console.log(
      `[kie-apply] ${caIds.length} newly counts-against committees carry $${Math.round(
        Number(impact[0].total),
      ).toLocaleString()} of counts-against contributions`,
    );
  }

  if (dryRun) {
    console.log('[kie-apply] DRY RUN — no writes');
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const id of updateIds) {
    await prisma.pacClassification.update({
      where: { committeeId: id },
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        class: data[id].class as any,
        reason: data[id].reason.slice(0, 500),
        source: 'kie-batch',
      },
    });
    done += 1;
    if (done % 100 === 0) console.log(`[kie-apply]   ${done}/${updateIds.length}`);
  }
  console.log(`[kie-apply] ✓ updated ${done} committees`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
