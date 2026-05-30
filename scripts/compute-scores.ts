// scripts/compute-scores.ts
//
// Phase 4 driver: turn verified MarkerAchievements into RepresentativeScore
// rows, optionally publish them, and (with a temporary stand-in flag) flip
// every unverified achievement to verified so we have something to show
// before the Phase 6 admin UI exists.
//
// Usage:
//   npx tsx scripts/compute-scores.ts                          # compute only, don't publish
//   npx tsx scripts/compute-scores.ts --publish                # compute + publish (visible on public pages)
//   npx tsx scripts/compute-scores.ts --auto-verify --publish  # also auto-verify all unverified achievements
//   npx tsx scripts/compute-scores.ts --jurisdiction=CA --publish
//   npx tsx scripts/compute-scores.ts --dry-run                # no DB writes
//
// `--auto-verify` is a STAND-IN for Phase 6's admin verification UI. It
// bulk-flips every MarkerAchievement.verifiedAt to NOW() with verifiedBy
// = "auto-verify-temp". Real human verification is still the goal —
// this just unblocks demo / dev-mode work in the meantime. Logs loudly.

import './load-env';

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  METHODOLOGY_VERSION,
  pacScoreFromRatio,
  scoreLegislator,
  type ScoringPlank,
} from '../src/lib/scorecard/scoring';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  jurisdiction: 'FEDERAL' | 'CA' | 'BOTH';
  dryRun: boolean;
  publish: boolean;
  autoVerify: boolean;
  /** Only recompute legislators whose achievements have updated since their last score. */
  changesOnly: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    jurisdiction: 'BOTH',
    dryRun: false,
    publish: false,
    autoVerify: false,
    changesOnly: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--publish') flags.publish = true;
    else if (arg === '--auto-verify') flags.autoVerify = true;
    else if (arg === '--changes-only') flags.changesOnly = true;
    else if (arg.startsWith('--jurisdiction=')) {
      const v = arg.split('=')[1].toUpperCase();
      if (v === 'FEDERAL' || v === 'CA' || v === 'BOTH') flags.jurisdiction = v as CliFlags['jurisdiction'];
    }
  }
  return flags;
}

/** Threshold for the corporate-pac-refusal marker, per methodology v1.0 §1. */
const CORPORATE_PAC_THRESHOLD = 0.05;

/**
 * Computes the corporate-pac-refusal MarkerAchievement for every active
 * legislator from their most recent PacMoneyData row. This is one of the
 * non-bill-shaped achievements — it has no MarkerBill, just a public-data
 * derivation. Always verified-at-write-time because the source is FEC /
 * Cal-Access filings, which need no human review beyond the
 * CommitteeClassification table itself.
 */
async function computePacAchievements(
  jurisdiction: CliFlags['jurisdiction'],
  dryRun: boolean,
): Promise<{ written: number; achieved: number; skippedNullRatio: number }> {
  // Find both markers (federal + CA) — they have parallel slugs.
  const markers = await prisma.marker.findMany({
    where: { slug: { in: ['corporate-pac-refusal', 'corporate-pac-refusal-ca'] } },
    select: { id: true, slug: true, jurisdiction: true },
  });
  if (markers.length === 0) {
    console.warn('  [pac] no corporate-pac-refusal marker found in DB — skip');
    return { written: 0, achieved: 0, skippedNullRatio: 0 };
  }
  const markerByJurisdiction = new Map(markers.map((m) => [m.jurisdiction as 'FEDERAL' | 'CA', m]));

  const legislators = await prisma.legislator.findMany({
    where: {
      isActive: true,
      ...(jurisdiction !== 'BOTH' ? { jurisdiction } : {}),
    },
    select: {
      id: true,
      jurisdiction: true,
      fullName: true,
      pacData: {
        // Highest-fidelity source first, then most recent cycle.
        orderBy: [{ dataSource: 'asc' }, { cycleYear: 'desc' }],
        select: { corporatePacPercentage: true, combinedCorporateRatio: true, cycleYear: true, dataSourceUrl: true },
      },
    },
  });

  let written = 0;
  let achieved = 0;
  let skippedNullRatio = 0;
  for (const leg of legislators) {
    const pac = leg.pacData[0];
    if (!pac) continue;
    const marker = markerByJurisdiction.get(leg.jurisdiction as 'FEDERAL' | 'CA');
    if (!marker) continue;
    // Null-ratio guard: when BOTH source fields are null, treat as "no data" rather
    // than collapsing to 0 (which pacScoreFromRatio rewards as a perfect +2). A legitimate
    // zero-corporate-receipt case (totalReceipts > 0, corporatePacAmount = 0) still has
    // corporatePacPercentage = 0 (not null), so this guard does not skip those rows.
    if (pac.combinedCorporateRatio == null && pac.corporatePacPercentage == null) {
      skippedNullRatio += 1;
      console.warn(
        `[compute-scores] skipping ${leg.fullName} (${leg.jurisdiction}): both combinedCorporateRatio and corporatePacPercentage are null — no PAC data, not "0% corporate"`,
      );
      continue;
    }
    const ratio = Number(pac.combinedCorporateRatio ?? pac.corporatePacPercentage ?? 0);
    const continuousScore = pacScoreFromRatio(ratio);
    const actionTaken = continuousScore >= 0 ? 'ACTED_FOR' : 'ACTED_AGAINST';
    if (continuousScore >= 0) achieved += 1;

    if (dryRun) {
      written += 1;
      continue;
    }

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
    written += 1;
  }
  return { written, achieved, skippedNullRatio };
}

async function autoVerifyAll(jurisdiction: CliFlags['jurisdiction'], dryRun: boolean): Promise<number> {
  console.warn(
    '⚠️  [compute-scores] --auto-verify is set. Bulk-flipping all unverified MarkerAchievements ' +
      'to verified. This is a TEMPORARY STAND-IN for Phase 6 admin verification UI; do not run ' +
      'in production with real-world data without human review.',
  );
  const where = {
    verifiedAt: null,
    ...(jurisdiction !== 'BOTH' ? { marker: { plank: { jurisdiction } } } : {}),
  };
  if (dryRun) {
    const count = await prisma.markerAchievement.count({ where });
    console.log(`  [dry-run] would auto-verify ${count} achievement(s)`);
    return count;
  }
  const now = new Date();
  const result = await prisma.markerAchievement.updateMany({
    where,
    data: { verifiedAt: now, verifiedBy: 'auto-verify-temp' },
  });
  console.log(`  [auto-verify] verified ${result.count} achievement(s)`);
  return result.count;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[compute-scores] flags: ${JSON.stringify(flags)}`);

  // PAC-derived achievements run before the auto-verify step because they
  // self-verify — no need to flip them after. They also need to land
  // before scoring so the scorer picks them up.
  const pacResult = await computePacAchievements(flags.jurisdiction, flags.dryRun);
  console.log(
    `[compute-scores] pac achievements: wrote ${pacResult.written}, ${pacResult.achieved} pass the <5% threshold, skipped ${pacResult.skippedNullRatio} (both ratio fields null = no data)`,
  );

  if (flags.autoVerify) {
    await autoVerifyAll(flags.jurisdiction, flags.dryRun);
  }

  // Load planks (with markers) for the jurisdictions in scope.
  const planks = await prisma.plank.findMany({
    where: flags.jurisdiction !== 'BOTH' ? { jurisdiction: flags.jurisdiction } : undefined,
    orderBy: [{ jurisdiction: 'asc' }, { number: 'asc' }],
    include: { markers: true },
  });
  console.log(`[compute-scores] loaded ${planks.length} plank(s) across markers`);

  // Group planks by jurisdiction so each legislator scores only against their own.
  const planksByJurisdiction = new Map<'FEDERAL' | 'CA', ScoringPlank[]>();
  for (const p of planks) {
    const key = p.jurisdiction as 'FEDERAL' | 'CA';
    const list = planksByJurisdiction.get(key) ?? [];
    list.push({
      id: p.id,
      number: p.number,
      markers: p.markers.map((m) => ({ id: m.id, markerType: m.markerType as 'PRIMARY' | 'SECONDARY' })),
    });
    planksByJurisdiction.set(key, list);
  }

  // Load active legislators with their THREE-STATE achievements
  // (we need actionTaken to apply +1 / -1).
  const legislators = await prisma.legislator.findMany({
    where: {
      isActive: true,
      ...(flags.jurisdiction !== 'BOTH' ? { jurisdiction: flags.jurisdiction } : {}),
    },
    select: {
      id: true,
      jurisdiction: true,
      fullName: true,
      achievements: {
        where: { verifiedAt: { not: null }, actionTaken: { not: null } },
        select: {
          markerId: true,
          actionTaken: true,
          updatedAt: true,
          achieved: true,
          evidenceType: true,
          sponsorTier: true,
          achievementScore: true,
        },
      },
      ...(flags.changesOnly
        ? {
            scores: {
              where: { methodologyVersion: METHODOLOGY_VERSION },
              orderBy: { computedAt: 'desc' },
              take: 1,
              select: { computedAt: true },
            },
          }
        : {}),
    },
  });

  let candidates = legislators;
  if (flags.changesOnly) {
    candidates = legislators.filter((l) => {
      const lastAchievement = l.achievements.reduce<Date | null>(
        (max, a) => (max === null || a.updatedAt > max ? a.updatedAt : max),
        null,
      );
      const lastScore = (l as unknown as { scores?: Array<{ computedAt: Date }> }).scores?.[0]?.computedAt ?? null;
      if (!lastScore) return true;
      if (!lastAchievement) return false;
      return lastAchievement > lastScore;
    });
    console.log(
      `[compute-scores] changes-only: ${candidates.length} of ${legislators.length} legislator(s) have stale scores`,
    );
  } else {
    console.log(`[compute-scores] scoring ${legislators.length} legislator(s)`);
  }

  // BULK WRITES via raw INSERT ... ON CONFLICT ... DO UPDATE. Per-row
  // Prisma upsert in $transaction batches was ~30 seconds for 3,170 rows;
  // a 500-row parameterised VALUES insert collapses that to ~3 sec and
  // scales linearly as we add more legislators or methodology versions.
  // Same pattern proven on CA classifications (29k rows in ~4 min).
  interface ScoreRow {
    legislatorId: string;
    plankId: string;
    score: number;
    forCount: number;
    againstCount: number;
    notes: string | null;
  }
  const pendingScores: ScoreRow[] = [];
  let totalScores = 0;
  let positiveScores = 0;
  let negativeScores = 0;

  for (const leg of candidates) {
    const jurisdiction = leg.jurisdiction as 'FEDERAL' | 'CA';
    const planksForJurisdiction = planksByJurisdiction.get(jurisdiction) ?? [];
    if (planksForJurisdiction.length === 0) continue;

    const result = scoreLegislator(planksForJurisdiction, {
      legislatorId: leg.id,
      achievements: leg.achievements.map((a) => ({
        markerId: a.markerId,
        achieved: a.achieved,
        actionTaken: a.actionTaken,
        evidenceType: a.evidenceType,
        sponsorTier: a.sponsorTier,
        achievementScore: Number(a.achievementScore ?? 0) || null,
      })),
    });

    for (const ps of result.perPlank) {
      totalScores += 1;
      if (ps.score > 0) positiveScores += 1;
      else if (ps.score < 0) negativeScores += 1;
      if (flags.dryRun) continue;
      pendingScores.push({
        legislatorId: leg.id,
        plankId: ps.plankId,
        score: ps.score,
        forCount: ps.forCount,
        againstCount: ps.againstCount,
        notes: ps.notes,
      });
    }
  }

  if (!flags.dryRun && pendingScores.length > 0) {
    const BATCH = 500;
    const now = new Date();
    let written = 0;
    for (let i = 0; i < pendingScores.length; i += BATCH) {
      const slice = pendingScores.slice(i, i + BATCH);
      const params: unknown[] = [];
      const values = slice
        .map((row, idx) => {
          const base = idx * 8;
          // score column is Int in schema. The continuous PAC gradient
          // produces floats; Prisma's typed upsert silently rounded, raw SQL
          // doesn't — so we round here for parity with prior behavior.
          params.push(
            row.legislatorId,
            row.plankId,
            Math.round(row.score),
            row.forCount,
            row.againstCount,
            METHODOLOGY_VERSION,
            row.notes,
            flags.publish ? now : null,
          );
          return `(gen_random_uuid()::text, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${
            base + 6
          }, $${base + 7}, $${base + 8}, NOW(), NOW())`;
        })
        .join(',');
      const publishedClause = flags.publish ? `"publishedAt" = EXCLUDED."publishedAt",` : '';
      const sql =
        `INSERT INTO "RepresentativeScore" ` +
        `("id", "legislatorId", "plankId", "score", "forCount", "againstCount", "methodologyVersion", "notes", "publishedAt", "createdAt", "updatedAt") ` +
        `VALUES ${values} ` +
        `ON CONFLICT ("legislatorId", "plankId", "methodologyVersion") DO UPDATE SET ` +
        `"score" = EXCLUDED."score", ` +
        `"forCount" = EXCLUDED."forCount", ` +
        `"againstCount" = EXCLUDED."againstCount", ` +
        `"notes" = EXCLUDED."notes", ` +
        publishedClause +
        `"updatedAt" = NOW()`;
      await prisma.$executeRawUnsafe(sql, ...params);
      written += slice.length;
    }
    console.log(
      `[compute-scores] bulk-upsert path: ${written} rows in ${Math.ceil(pendingScores.length / BATCH)} batch(es)`,
    );
  }

  console.log(
    `[compute-scores] summary: ${totalScores} score row(s) written · ${positiveScores} positive · ${negativeScores} negative · ${
      totalScores - positiveScores - negativeScores
    } zero` + (flags.publish ? ` — published` : ` — NOT published (rerun with --publish)`),
  );
  if (flags.dryRun) console.log('[compute-scores] DRY RUN — no DB writes performed.');

  // Compute ScoreCalibration anchors for the CURRENT methodology version,
  // from the score rows we just wrote. Earlier hardcoded 'v1.4' refs were
  // a bug — bumped here to track METHODOLOGY_VERSION so the anchors always
  // belong to the version the engine just published.
  console.log(`[compute-scores] computing ${METHODOLOGY_VERSION} percentile anchors...`);
  const allScores = await prisma.representativeScore.findMany({
    where: { methodologyVersion: METHODOLOGY_VERSION, publishedAt: { not: null } },
    select: { legislatorId: true, score: true },
  });
  // Aggregate to per-legislator totals (sum across planks)
  const totalsByLegislator = new Map<string, number>();
  for (const s of allScores) {
    totalsByLegislator.set(s.legislatorId, (totalsByLegislator.get(s.legislatorId) ?? 0) + s.score);
  }
  const totals = [...totalsByLegislator.values()].sort((a, b) => a - b);
  // Anchor strategy: min/max. Earlier draft used 95th/5th percentiles —
  // that crushed ≥35 top-scoring legislators (everyone at +11 and above)
  // to indistinguishable +100% display, defeating the point of having a
  // scaled view. With a bounded distribution (658 legislators, integer
  // scores roughly in [-3, +17] for v1.4) there are no statistical
  // outliers to protect against, so min/max gives every legislator a
  // unique slot on the -100%..+100% scale.
  const positiveAnchor = totals.length > 0 ? totals[totals.length - 1] : 0;
  const negativeAnchor = totals.length > 0 ? totals[0] : 0;
  await prisma.scoreCalibration.upsert({
    where: { methodologyVersion: METHODOLOGY_VERSION },
    create: {
      methodologyVersion: METHODOLOGY_VERSION,
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
    `[compute-scores] ${METHODOLOGY_VERSION} anchors: +100% = ${positiveAnchor} raw, -100% = ${negativeAnchor} raw (from ${totalsByLegislator.size} legislators)`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
