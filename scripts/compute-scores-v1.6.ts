// v1.6 scoring engine — computes alignment-percentage per (legislator, plank)
// from RollCallVote + RollCallPosition data.
//
// Formula per (legislator, plank):
//
//   aligned   = count(positions where vote.isScorable AND plank in vote.plankNumbers
//                                AND legislator's position == vote.alignedPosition)
//   not_aligned = count(positions where same plank-relevant filter,
//                                     AND legislator's position != vote.alignedPosition)
//   plank_score = (aligned / (aligned + not_aligned)) × 100
//
// "Not aligned" includes recorded misalignment AND absences (NOT_VOTING,
// EXCUSED, PRESENT) — preserves v1.5 methodology stance that "all five
// non-yes positions count the same."
//
// Total: simple mean of per-plank percents. Range 0-100% (no negatives).
//
// Run: npm run scorecard:compute-v16
//      npm run scorecard:compute-v16 -- --publish
//      npm run scorecard:compute-v16 -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const METHODOLOGY_VERSION = 'v1.6';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  dryRun: boolean;
  publish: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, publish: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--publish') flags.publish = true;
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[compute-v16] flags: ${JSON.stringify(flags)}`);

  // Pull all scorable votes + their classifications
  const scorableVotes = await prisma.rollCallVote.findMany({
    where: { isScorable: true },
    select: {
      id: true,
      plankNumbers: true,
      alignedPosition: true,
      positions: {
        select: { legislatorId: true, position: true },
      },
    },
  });
  console.log(`[compute-v16] ${scorableVotes.length} scorable votes loaded`);

  // Tally per (legislator, plank): aligned / not_aligned counts
  const tally = new Map<string, { aligned: number; notAligned: number }>(); // key: `${legId}|${plank}`
  for (const v of scorableVotes) {
    const aligned = v.alignedPosition;
    if (!aligned || v.plankNumbers.length === 0) continue;
    for (const pos of v.positions) {
      const isAligned = pos.position === aligned;
      for (const plank of v.plankNumbers) {
        const key = `${pos.legislatorId}|${plank}`;
        const cur = tally.get(key) ?? { aligned: 0, notAligned: 0 };
        if (isAligned) cur.aligned += 1;
        else cur.notAligned += 1;
        tally.set(key, cur);
      }
    }
  }
  console.log(`[compute-v16] ${tally.size} (legislator, plank) cells tallied`);

  // Lookup planks by number (one row per plank, jurisdiction=FEDERAL)
  const planks = await prisma.plank.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, number: true },
  });
  const plankIdByNumber = new Map(planks.map((p) => [p.number, p.id]));

  // Build per-legislator score rows
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', isActive: true },
    select: { id: true },
  });
  console.log(`[compute-v16] computing scores for ${legs.length} federal legislators`);

  interface ScoreRow {
    legislatorId: string;
    plankId: string;
    percent: number;
    aligned: number;
    notAligned: number;
  }
  const scoreRows: ScoreRow[] = [];
  let scoredLegislators = 0;
  for (const leg of legs) {
    let plankScoreCount = 0;
    for (const [plankNum, plankId] of plankIdByNumber.entries()) {
      const key = `${leg.id}|${plankNum}`;
      const t = tally.get(key);
      if (!t) continue;
      const total = t.aligned + t.notAligned;
      if (total === 0) continue;
      const pct = (t.aligned / total) * 100;
      scoreRows.push({
        legislatorId: leg.id,
        plankId,
        percent: pct,
        aligned: t.aligned,
        notAligned: t.notAligned,
      });
      plankScoreCount += 1;
    }
    if (plankScoreCount > 0) scoredLegislators += 1;
  }
  console.log(`[compute-v16] ${scoreRows.length} score rows across ${scoredLegislators} legislators`);

  if (flags.dryRun) {
    console.log(`\n[compute-v16] DRY RUN — distribution preview:`);
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const s of scoreRows) {
      const b = Math.min(9, Math.floor(s.percent / 10));
      buckets[b] += 1;
    }
    for (let i = 0; i < 10; i += 1) {
      console.log(
        `  ${(i * 10).toString().padStart(3)}-${(i * 10 + 10).toString().padStart(3)}%: ${'█'.repeat(
          Math.min(50, Math.round(buckets[i] / 5)),
        )} ${buckets[i]}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // Bulk-upsert via raw SQL — same pattern as v1.5 compute. Score stored
  // as Int (rounded percent). forCount/againstCount become aligned/notAligned.
  const now = new Date();
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < scoreRows.length; i += BATCH) {
    const slice = scoreRows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((row, idx) => {
        const base = idx * 8;
        params.push(
          row.legislatorId,
          row.plankId,
          Math.round(row.percent),
          row.aligned,
          row.notAligned,
          METHODOLOGY_VERSION,
          `aligned=${row.aligned}, not_aligned=${row.notAligned}, percent=${row.percent.toFixed(2)}`,
          flags.publish ? now : null,
        );
        return `(gen_random_uuid()::text, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${
          base + 6
        }, $${base + 7}, $${base + 8}, NOW(), NOW())`;
      })
      .join(',');
    const publishClause = flags.publish ? `"publishedAt" = EXCLUDED."publishedAt",` : '';
    const sql =
      `INSERT INTO "RepresentativeScore" ` +
      `("id", "legislatorId", "plankId", "score", "forCount", "againstCount", "methodologyVersion", "notes", "publishedAt", "createdAt", "updatedAt") ` +
      `VALUES ${values} ` +
      `ON CONFLICT ("legislatorId", "plankId", "methodologyVersion") DO UPDATE SET ` +
      `"score" = EXCLUDED."score", ` +
      `"forCount" = EXCLUDED."forCount", ` +
      `"againstCount" = EXCLUDED."againstCount", ` +
      `"notes" = EXCLUDED."notes", ` +
      publishClause +
      `"updatedAt" = NOW()`;
    await prisma.$executeRawUnsafe(sql, ...params);
    written += slice.length;
  }
  console.log(`[compute-v16] ✓ ${written} v1.6 score rows written${flags.publish ? ' (published)' : ' (unpublished)'}`);

  // Calibration anchors: for v1.6, scores are already 0-100, no anchoring
  // needed. But we still write a row so the page query works uniformly.
  await prisma.scoreCalibration.upsert({
    where: { methodologyVersion: METHODOLOGY_VERSION },
    create: {
      methodologyVersion: METHODOLOGY_VERSION,
      positiveAnchor: 100,
      negativeAnchor: 0,
      computedFromCount: scoredLegislators,
    },
    update: { positiveAnchor: 100, negativeAnchor: 0, computedFromCount: scoredLegislators, computedAt: new Date() },
  });
  console.log(`[compute-v16] anchors: 0% → 0, 100% → 100 (linear; no rescaling needed)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
