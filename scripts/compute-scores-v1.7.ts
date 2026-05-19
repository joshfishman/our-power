// v1.7 scoring engine — two-score methodology.
//
// Score 1 = PAC score  ((1 − combined_corporate_ratio) × 100)
// Score 2 = Voting Record  (aligned_BILLS / total_BILLS × 100)
//
// "Aligned for a bill" if legislator either:
//   (a) voted aligned on ANY RollCallVote for that bill, OR
//   (b) cosponsored that bill.
//
// Bill-level dedup: even if a bill appears in 4 procedural roll calls, it
// counts as 1 bill (not 4 votes). This is a deliberate v1.6 → v1.7 fix —
// previously each procedural vote inflated the denominator.
//
// What this script writes: RepresentativeScore rows per (legislator, plank)
// using the v1.7 methodology version. Each row's `score` is the per-plank
// Voting Record percent (0-100), computed bill-level with cosponsorship folded
// in. The overall Voting Record number, the PAC Score, and the Average are
// computed live in the UI (queries.ts) from PacMoneyData + these rows.
//
// Run:
//   npm run scorecard:compute-v17
//   npm run scorecard:compute-v17 -- --dry-run
//   npm run scorecard:compute-v17 -- --publish

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const METHODOLOGY_VERSION = 'v1.7';

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

type RcChamber = 'HOUSE' | 'SENATE' | 'CA_ASSEMBLY' | 'CA_SENATE';
type Jurisdiction = 'FEDERAL' | 'CA';
type LegChamber = 'SEN' | 'REP';

function jurisdictionForChamber(c: RcChamber): Jurisdiction {
  return c === 'HOUSE' || c === 'SENATE' ? 'FEDERAL' : 'CA';
}

// Map RollCallChamber → (jurisdiction, legChamber) for matching against
// Legislator.jurisdiction + Legislator.chamber.
function billChamberMatchesLeg(billChamber: RcChamber, legJur: Jurisdiction, legChamber: LegChamber): boolean {
  const billJur = jurisdictionForChamber(billChamber);
  if (billJur !== legJur) return false;
  const legChamberFromBill: LegChamber = billChamber === 'HOUSE' || billChamber === 'CA_ASSEMBLY' ? 'REP' : 'SEN';
  return legChamberFromBill === legChamber;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[compute-v17] flags: ${JSON.stringify(flags)}`);

  // 1. Pull all scorable plank-relevant votes with positions.
  const scorableVotes = await prisma.rollCallVote.findMany({
    where: { isScorable: true, alignedPosition: { not: null }, plankNumbers: { isEmpty: false } },
    select: {
      id: true,
      chamber: true,
      billType: true,
      billNumber: true,
      plankNumbers: true,
      alignedPosition: true,
      positions: { select: { legislatorId: true, position: true } },
    },
  });
  console.log(`[compute-v17] ${scorableVotes.length} scorable plank-relevant votes loaded`);

  // 2. Reduce votes → per-bill: unique (chamber, billType, billNumber) → {
  //    plankSet, alignedPosition (most common), legislators_who_voted_aligned: Set<legId>
  // }
  interface BillState {
    chamber: RcChamber;
    billType: string;
    billNumber: string;
    plankSet: Set<number>;
    alignedYes: number;
    alignedNo: number;
    legsAligned: Set<string>;
  }
  const bills = new Map<string, BillState>();
  for (const v of scorableVotes) {
    if (!v.billType || !v.billNumber || !v.alignedPosition) continue;
    const key = `${v.chamber}|${v.billType}|${v.billNumber}`;
    let bill = bills.get(key);
    if (!bill) {
      bill = {
        chamber: v.chamber as RcChamber,
        billType: v.billType,
        billNumber: v.billNumber,
        plankSet: new Set(),
        alignedYes: 0,
        alignedNo: 0,
        legsAligned: new Set(),
      };
      bills.set(key, bill);
    }
    for (const p of v.plankNumbers) bill.plankSet.add(p);
    if (v.alignedPosition === 'YES') bill.alignedYes += 1;
    else if (v.alignedPosition === 'NO') bill.alignedNo += 1;
    for (const pos of v.positions) {
      if (pos.position === v.alignedPosition) bill.legsAligned.add(pos.legislatorId);
    }
  }
  console.log(`[compute-v17] ${bills.size} distinct (chamber, bill) pairs`);

  // 3. Load cosponsors, key by (chamber/juris, billType, billNumber).
  const cosponsorRows = await prisma.billCosponsor.findMany({
    select: { jurisdiction: true, billType: true, billNumber: true, legislatorId: true },
  });
  // Cosponsor key uses jurisdiction (FEDERAL/CA), not chamber, because federal
  // House and Senate bills have distinct billType strings already (HR/S).
  const cosponsorsByBill = new Map<string, Set<string>>();
  for (const c of cosponsorRows) {
    const key = `${c.jurisdiction}|${c.billType}|${c.billNumber}`;
    let s = cosponsorsByBill.get(key);
    if (!s) {
      s = new Set();
      cosponsorsByBill.set(key, s);
    }
    s.add(c.legislatorId);
  }
  console.log(
    `[compute-v17] ${cosponsorRows.length} cosponsor rows · ${cosponsorsByBill.size} distinct bills with cosponsors`,
  );

  // 4. Load all legislators with their chamber → plank set up tally.
  const legs = await prisma.legislator.findMany({
    where: { isActive: true },
    select: { id: true, jurisdiction: true, chamber: true, fullName: true, lastName: true, party: true },
  });
  console.log(`[compute-v17] computing scores for ${legs.length} active legislators`);

  // Lookup plank UUIDs by (jurisdiction, number).
  const planks = await prisma.plank.findMany({ select: { id: true, number: true, jurisdiction: true } });
  const plankIdByJurNum = new Map<string, string>();
  for (const p of planks) plankIdByJurNum.set(`${p.jurisdiction}|${p.number}`, p.id);

  // 5. For each (leg, plank): count aligned_bills / total_bills.
  //    A bill is in the leg's universe if:
  //      - bill.chamber matches leg's chamber (House/Senate gating)
  //      - bill's plankSet includes the plank
  //
  //    leg is aligned on the bill if:
  //      - leg is in bill.legsAligned, OR
  //      - leg.id ∈ cosponsorsByBill[`${juris}|${billType}|${billNumber}`]
  interface ScoreRow {
    legislatorId: string;
    plankId: string;
    aligned: number;
    total: number;
    percent: number;
  }
  const scoreRows: ScoreRow[] = [];
  // Track per-leg overall stats for distribution preview
  const overallByLeg = new Map<
    string,
    { aligned: number; total: number; name: string; party: string; juris: string }
  >();
  for (const leg of legs) {
    const legJur = leg.jurisdiction as Jurisdiction;

    // Per-plank tallies for this leg
    const perPlank: Record<number, { aligned: number; total: number }> = {};
    let overallAligned = 0;
    let overallTotal = 0;

    for (const bill of bills.values()) {
      // Chamber gating: only count bills in the chamber this legislator sits in.
      if (!billChamberMatchesLeg(bill.chamber, legJur, leg.chamber as LegChamber)) continue;

      const cosponsorKey = `${legJur}|${bill.billType}|${bill.billNumber}`;
      const cosponsored = cosponsorsByBill.get(cosponsorKey)?.has(leg.id) ?? false;
      const votedAligned = bill.legsAligned.has(leg.id);
      const isAlignedOnBill = votedAligned || cosponsored;

      overallTotal += 1;
      if (isAlignedOnBill) overallAligned += 1;

      for (const plankNum of bill.plankSet) {
        // CA has no Plank 5 — skip silently. (Bills cross-classified across
        // both juris's plank numbers are extremely rare but be safe.)
        const plankId = plankIdByJurNum.get(`${legJur}|${plankNum}`);
        if (!plankId) continue;
        const cur = perPlank[plankNum] ?? { aligned: 0, total: 0 };
        cur.total += 1;
        if (isAlignedOnBill) cur.aligned += 1;
        perPlank[plankNum] = cur;
      }
    }

    for (const [plankNumStr, t] of Object.entries(perPlank)) {
      if (t.total === 0) continue;
      const plankNum = Number(plankNumStr);
      const plankId = plankIdByJurNum.get(`${legJur}|${plankNum}`);
      if (!plankId) continue;
      scoreRows.push({
        legislatorId: leg.id,
        plankId,
        aligned: t.aligned,
        total: t.total,
        percent: (t.aligned / t.total) * 100,
      });
    }

    if (overallTotal > 0) {
      overallByLeg.set(leg.id, {
        aligned: overallAligned,
        total: overallTotal,
        name: leg.fullName,
        party: leg.party,
        juris: leg.jurisdiction,
      });
    }
  }
  console.log(`[compute-v17] ${scoreRows.length} per-plank score rows across ${overallByLeg.size} legislators`);

  if (flags.dryRun) {
    console.log(`\n[compute-v17] DRY RUN — per-leg overall Voting distribution:`);
    const buckets = new Array(10).fill(0);
    for (const o of overallByLeg.values()) {
      const pct = (o.aligned / o.total) * 100;
      const b = Math.min(9, Math.floor(pct / 10));
      buckets[b] += 1;
    }
    for (let i = 9; i >= 0; i -= 1) {
      console.log(
        `  ${(i * 10).toString().padStart(3)}-${(i * 10 + 10).toString().padStart(3)}%: ${'█'.repeat(
          Math.min(60, Math.round(buckets[i] / 3)),
        )} ${buckets[i]}`,
      );
    }

    // Marquee spotcheck — same names as model-two-score.ts
    const targets = [
      'Ocasio-Cortez',
      'Hawley',
      'Pelosi',
      'Cruz',
      'Norman',
      'Vargas',
      'Sanders',
      'Kalra',
      'Wiener',
      'Gallagher',
    ];
    console.log(`\n[compute-v17] marquee:`);
    for (const last of targets) {
      const match = legs.find((l) => l.lastName === last);
      if (!match) continue;
      const o = overallByLeg.get(match.id);
      if (!o) continue;
      const pct = Math.round((o.aligned / o.total) * 100);
      console.log(
        `  ${match.party} ${match.fullName.padEnd(35)} ${match.jurisdiction.padEnd(6)}  Voting=${pct
          .toString()
          .padStart(3)}%  (${o.aligned}/${o.total})`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // 6. Bulk-upsert RepresentativeScore rows. Use raw SQL pattern proven in v1.6.
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
          row.total - row.aligned,
          METHODOLOGY_VERSION,
          `aligned=${row.aligned}, total=${row.total}, percent=${row.percent.toFixed(
            2,
          )} (bill-level, includes cosponsorship)`,
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
  console.log(
    `[compute-v17] ✓ ${written} v1.7 per-plank rows written${flags.publish ? ' (published)' : ' (unpublished)'}`,
  );

  // Calibration anchor row (UI uniformity)
  await prisma.scoreCalibration.upsert({
    where: { methodologyVersion: METHODOLOGY_VERSION },
    create: {
      methodologyVersion: METHODOLOGY_VERSION,
      positiveAnchor: 100,
      negativeAnchor: 0,
      computedFromCount: overallByLeg.size,
    },
    update: { positiveAnchor: 100, negativeAnchor: 0, computedFromCount: overallByLeg.size, computedAt: new Date() },
  });
  console.log(`[compute-v17] anchors: 0% → 0, 100% → 100`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
