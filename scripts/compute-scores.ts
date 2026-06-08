// scripts/compute-scores.ts
//
// The scorecard compute driver. Writes RepresentativeScore rows using the
// RATIO voting model (per-(legislator, plank) aligned ÷ total × 100), via the
// shared src/lib/scorecard/voting-alignment.ts module, then computes the
// separate PAC achievements and (with a stand-in flag) auto-verifies.
//
//   Voting (per plank) = aligned ÷ eligible × 100
//     eligible = scorable roll-call bills gated to the leg's chamber ∪ marker
//                scoring-slots for that plank (bill-level dedup)
//     aligned  = voted-aligned ∪ cosponsored ∪ marker-sponsored
//     an absence / NO vote is a denominator drag, never −1
//   Insufficient data is EXCLUDED, not zero: a plank with 0 eligible bills
//     gets NO row (so it drops out of the average); a genuinely-unaligned
//     plank still scores a real 0%.
//   PAC is its OWN score (computePacAchievements) — the ratio scorer skips
//     bill-less markers, so the PAC marker never enters a plank voting tally.
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
import { METHODOLOGY_VERSION, pacScoreFromRatio } from '../src/lib/scorecard/scoring';
import {
  loadAlignmentUniverse,
  computePlankTallies,
  type Jurisdiction,
  type LegChamber,
} from '../src/lib/scorecard/voting-alignment';

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

  // Load plank UUIDs by (jurisdiction, number) — the ratio model tallies by
  // plank NUMBER (from RollCallVote.plankNumbers / Marker.plank), so we map
  // back to the plankId UUID for the RepresentativeScore row.
  const planks = await prisma.plank.findMany({
    where: flags.jurisdiction !== 'BOTH' ? { jurisdiction: flags.jurisdiction } : undefined,
    select: { id: true, number: true, jurisdiction: true },
  });
  const plankIdByJurNum = new Map<string, string>();
  for (const p of planks) plankIdByJurNum.set(`${p.jurisdiction}|${p.number}`, p.id);
  console.log(`[compute-scores] loaded ${planks.length} plank(s)`);

  // Load the shared alignment universe (scorable roll-call bills, cosponsors,
  // marker scoring-slots). This is the SAME source of truth the display layer
  // (queries.ts getLegislatorBillBreakdown) uses, so the score and the
  // "X aligned of Y bills" line can never disagree.
  const universe = await loadAlignmentUniverse(prisma);
  console.log(
    `[compute-scores] universe: ${universe.bills.size} bills · ${universe.cosponsorsByBill.size} cosponsored bills · ${universe.markerSlots.length} marker slots (bill-less markers excluded)`,
  );

  // Load active legislators. The ratio model needs chamber + jurisdiction for
  // gating; achievements are no longer used for voting tallies (PAC stays its
  // own separate score via computePacAchievements above). `--changes-only`
  // still filters on stale scores vs achievement updates.
  const legislators = await prisma.legislator.findMany({
    where: {
      isActive: true,
      ...(flags.jurisdiction !== 'BOTH' ? { jurisdiction: flags.jurisdiction } : {}),
    },
    select: {
      id: true,
      jurisdiction: true,
      chamber: true,
      state: true,
      fullName: true,
      lastName: true,
      party: true,
      ...(flags.changesOnly
        ? {
            achievements: {
              where: { verifiedAt: { not: null }, actionTaken: { not: null } },
              select: { updatedAt: true },
            },
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
      const achievements = (l as unknown as { achievements?: Array<{ updatedAt: Date }> }).achievements ?? [];
      const lastAchievement = achievements.reduce<Date | null>(
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
  interface ScoreRow {
    legislatorId: string;
    plankId: string;
    score: number; // round(aligned / total × 100)
    forCount: number; // aligned
    againstCount: number; // total - aligned (absence/NO drag, never -1)
    notes: string | null;
  }
  const pendingScores: ScoreRow[] = [];
  let totalScores = 0;
  let positiveScores = 0;
  let zeroScores = 0;
  // Per-leg overall voting % for the dry-run distribution + marquee spot-check.
  const overallByLeg = new Map<
    string,
    { aligned: number; total: number; name: string; lastName: string; party: string; juris: string }
  >();

  for (const leg of candidates) {
    const jurisdiction = leg.jurisdiction as Jurisdiction;
    const { perPlank, overall } = computePlankTallies(
      { id: leg.id, jurisdiction, chamber: leg.chamber as LegChamber, state: leg.state },
      universe,
    );

    for (const [plankNum, tally] of perPlank) {
      // Insufficient-data exclusion: only write a row where total ≥ 1. A plank
      // with 0 eligible bills gets NO row (excluded from the average). A
      // genuinely-engaged-but-unaligned plank still scores a real 0%.
      if (tally.total < 1) continue;
      const plankId = plankIdByJurNum.get(`${jurisdiction}|${plankNum}`);
      if (!plankId) continue; // e.g. CA has no Plank 5
      const percent = (tally.aligned / tally.total) * 100;
      totalScores += 1;
      if (percent > 0) positiveScores += 1;
      else zeroScores += 1;
      if (flags.dryRun) continue;
      pendingScores.push({
        legislatorId: leg.id,
        plankId,
        score: Math.round(percent),
        forCount: tally.aligned,
        againstCount: tally.total - tally.aligned,
        notes: `${METHODOLOGY_VERSION}: aligned=${tally.aligned}, total=${tally.total}, percent=${percent.toFixed(
          2,
        )} (bill-level: roll-call ∪ cosponsorship ∪ marker-sponsorship)`,
      });
    }

    if (overall.total > 0) {
      overallByLeg.set(leg.id, {
        aligned: overall.aligned,
        total: overall.total,
        name: leg.fullName,
        lastName: leg.lastName,
        party: leg.party,
        juris: leg.jurisdiction,
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
          // score is already round(aligned / total × 100) — the Int column
          // stores the integer percent directly.
          params.push(
            row.legislatorId,
            row.plankId,
            row.score,
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
    `[compute-scores] summary: ${totalScores} per-plank row(s) across ${overallByLeg.size} legislator(s) · ${positiveScores} > 0% · ${zeroScores} at 0%` +
      (flags.dryRun ? '' : flags.publish ? ` — published` : ` — NOT published (rerun with --publish)`),
  );

  // ─── Dry-run MARQUEE — how the human verifies Bernie ───────────────────────
  // Per-leg overall Voting distribution histogram + a spot-check list. Mirrors
  // the v1.7 dry-run output exactly (same target names).
  if (flags.dryRun) {
    console.log(`\n[compute-scores] DRY RUN — no DB writes performed.`);
    console.log(`\n[compute-scores] per-leg overall Voting distribution:`);
    const buckets = new Array(10).fill(0);
    for (const o of overallByLeg.values()) {
      const pct = (o.aligned / o.total) * 100;
      buckets[Math.min(9, Math.floor(pct / 10))] += 1;
    }
    for (let i = 9; i >= 0; i -= 1) {
      console.log(
        `  ${(i * 10).toString().padStart(3)}-${(i * 10 + 10).toString().padStart(3)}%: ${'█'.repeat(
          Math.min(60, Math.round(buckets[i] / 3)),
        )} ${buckets[i]}`,
      );
    }

    // Marquee spot-check — overall voting % + aligned/total for known names.
    const targets = ['Sanders', 'Ocasio-Cortez', 'Hawley', 'Cruz', 'Pelosi', 'Norman', 'Vargas'];
    console.log(`\n[compute-scores] marquee:`);
    for (const last of targets) {
      const match = [...overallByLeg.values()].find((o) => o.lastName === last);
      if (!match) {
        console.log(`  (no match for ${last})`);
        continue;
      }
      const pct = Math.round((match.aligned / match.total) * 100);
      console.log(
        `  ${match.party} ${match.name.padEnd(35)} ${match.juris.padEnd(6)}  Voting=${pct.toString().padStart(3)}%  (${
          match.aligned
        }/${match.total})`,
      );
    }
    return;
  }

  // ScoreCalibration anchors. v0.9 scores are already 0–100 percentages, so the
  // calibration is the identity: positiveAnchor=100 → +100%, negativeAnchor=0
  // → 0%. (No percentile fitting — the percent scale is the display scale.)
  await prisma.scoreCalibration.upsert({
    where: { methodologyVersion: METHODOLOGY_VERSION },
    create: {
      methodologyVersion: METHODOLOGY_VERSION,
      positiveAnchor: 100,
      negativeAnchor: 0,
      computedFromCount: overallByLeg.size,
    },
    update: {
      positiveAnchor: 100,
      negativeAnchor: 0,
      computedFromCount: overallByLeg.size,
      computedAt: new Date(),
    },
  });
  console.log(`[compute-scores] ${METHODOLOGY_VERSION} anchors: 100 → +100%, 0 → 0% (percent scale)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
