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
import { markerMeetsPopularSupportFloor, POPULAR_SUPPORT_FLOOR } from '../src/lib/scorecard/scoring';

const METHODOLOGY_VERSION = 'v1.7.1';

// ---------------------------------------------------------------------------
// ROLL-CALL TRUST GATE (default conservative)
// ---------------------------------------------------------------------------
// A roll-call bill only counts toward a legislator's per-plank Voting Record
// if its classification is TRUSTWORTHY:
//   (a) it was reviewed by a human — classificationSource is 'human' or
//       'auto-then-human', OR
//   (b) its classificationConfidence meets TRUSTWORTHY_CONFIDENCE_FLOOR.
//
// Why: the rule classifier derives a bill's ALIGNED DIRECTION purely from the
// sponsor's party (D→YES / R→NO). That heuristic is a coin-flip on bipartisan,
// Option-C, and messaging bills, so the classifier now caps those rows'
// confidence (DIRECTION_HEURISTIC_CONF_CAP=0.55 in plank-classifier.ts) and
// flags them needsReview. Counting them would launder a guess into a published
// score. The methodology promises every published score traces to
// human-verified evidence, so until the Phase-6 review UI populates verified
// rows, unreviewed low-confidence bills are EXCLUDED from both numerator and
// denominator.
//
// Curated MARKER scoring slots are unaffected — their plank+direction are
// authoritative (sourced from MarkerBill sponsorships, not RollCallVote
// classification) and always count. This gate applies ONLY to the roll-call
// bill universe.
//
// Set ROLL_CALL_TRUST_GATE=false (env) to disable the gate and score the full
// classified universe (legacy behavior) for comparison.
const ROLL_CALL_TRUST_GATE = process.env.ROLL_CALL_TRUST_GATE !== 'false';
// 0.95: only count roll-call bills the content classifier is highly confident
// belong to the plank (or that a human reviewed). The topic-based net at 0.8
// pulled in ~492 topically-adjacent bills; 0.95 narrows the Voting Record to a
// focused, defensible set of clear matches + curated markers.
const TRUSTWORTHY_CONFIDENCE_FLOOR = 0.95;
const REVIEWED_SOURCES = new Set(['human', 'auto-then-human']);

function isTrustworthyClassification(source: string | null, confidence: number | null): boolean {
  if (!ROLL_CALL_TRUST_GATE) return true;
  if (source && REVIEWED_SOURCES.has(source)) return true;
  return (confidence ?? 0) >= TRUSTWORTHY_CONFIDENCE_FLOOR;
}

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
      classificationSource: true,
      classificationConfidence: true,
      positions: { select: { legislatorId: true, position: true } },
    },
  });
  console.log(`[compute-v17] ${scorableVotes.length} scorable plank-relevant votes loaded`);

  // Apply the roll-call trust gate (see ROLL_CALL_TRUST_GATE above). Untrusted
  // rows are dropped from the scoring universe entirely — they contribute to
  // neither numerator nor denominator. Marker slots are added later and are
  // never gated.
  const trustedVotes = scorableVotes.filter((v) =>
    isTrustworthyClassification(v.classificationSource, v.classificationConfidence),
  );
  console.log(
    `[compute-v17] trust gate: ${ROLL_CALL_TRUST_GATE ? 'ON' : 'OFF'} ` +
      `(reviewed OR conf>=${TRUSTWORTHY_CONFIDENCE_FLOOR}) — ` +
      `${trustedVotes.length}/${scorableVotes.length} roll-call votes pass`,
  );

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
    // Every legislator who cast ANY recorded position on this bill's roll call(s).
    // Proves they were in office and had the chance to vote — the denominator is
    // gated on this so a member is never scored on a vote they couldn't cast
    // (wrong term / not yet elected / absent).
    legsVoted: Set<string>;
  }
  const bills = new Map<string, BillState>();
  for (const v of trustedVotes) {
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
        legsVoted: new Set(),
      };
      bills.set(key, bill);
    }
    for (const p of v.plankNumbers) bill.plankSet.add(p);
    if (v.alignedPosition === 'YES') bill.alignedYes += 1;
    else if (v.alignedPosition === 'NO') bill.alignedNo += 1;
    for (const pos of v.positions) {
      bill.legsVoted.add(pos.legislatorId);
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

  // 4a. v1.7.1 — load Marker scoring slots from BillSponsorship.
  //
  // Why: 32 of 33 federal marker bills never reached a roll-call vote (e.g.
  // H.Con.Res.38 war powers — 94 sponsors but no floor action). v1.7 looked
  // only at roll-call universe + BillCosponsor and missed all of them.
  // A senator who cosponsored zero marker bills inflated to 100% off 11
  // routine party-line votes; a House member who sponsored a marker bill
  // didn't see the credit. v1.7.1 adds markers as cross-chamber scoring
  // slots: every federal leg is scored on every federal marker, every CA
  // leg on every CA marker. Aligned iff sponsorship row exists for any of
  // the marker's bills.
  //
  // Markers without bills (e.g. "Refuses corporate PAC money") are skipped —
  // the PAC Score already handles that signal as its own headline number.
  const markers = await prisma.marker.findMany({
    include: {
      plank: { select: { number: true, jurisdiction: true } },
      // popularSupport pulled in for the popular-support-floor gate below.
      bills: {
        select: {
          id: true,
          congressNumber: true,
          billType: true,
          billNumber: true,
          sponsorships: { select: { legislatorId: true } },
        },
      },
    },
  });
  interface MarkerSlot {
    markerId: string;
    plankNumber: number;
    jurisdiction: Jurisdiction;
    alignedLegIds: Set<string>;
  }
  // Normalize MarkerBill billType + billNumber → BillCosponsor's storage form,
  // so we can union with the freshly-ingested marker cosponsor rows.
  const STORAGE_TYPE_MAP: Record<string, string> = {
    HOUSE_BILL: 'HR',
    SENATE_BILL: 'S',
    HOUSE_JOINT_RES: 'HJRES',
    SENATE_JOINT_RES: 'SJRES',
    HOUSE_CONCURRENT_RES: 'HCONRES',
    SENATE_CONCURRENT_RES: 'SCONRES',
    HOUSE_RES: 'HRES',
    SENATE_RES: 'SRES',
    CA_ASSEMBLY_BILL: 'CA_BILL',
    CA_SENATE_BILL: 'CA_BILL',
    CA_HOUSE_BILL: 'CA_BILL',
  };
  function stripBillNum(raw: string): string | null {
    const m = raw.match(/\d+/);
    return m ? m[0] : null;
  }
  const markerSlots: MarkerSlot[] = [];
  let belowFloorSkipped = 0;
  for (const m of markers) {
    if (m.bills.length === 0) continue; // bill-less markers (PAC) handled elsewhere
    // Popular-support floor (v1.9.2): markers assessed below the national
    // support floor are excluded from scoring. Null support still counts.
    if (!markerMeetsPopularSupportFloor(m)) {
      belowFloorSkipped += 1;
      continue;
    }
    const jur = m.plank.jurisdiction as Jurisdiction;
    const aligned = new Set<string>();
    // Source A: legacy BillSponsorship (curated, partial coverage)
    for (const b of m.bills) for (const s of b.sponsorships) aligned.add(s.legislatorId);
    // Source B: BillCosponsor — full Congress.gov-sourced rows ingested via
    // ingest-marker-cosponsors.ts. This gives uniform coverage across all 538
    // federal legs (and CA via ingest-cosponsors-ca.ts) so a senator who
    // sponsored a marker bill registers regardless of whether the older
    // BillSponsorship ingest picked them up.
    for (const b of m.bills) {
      const storageType = STORAGE_TYPE_MAP[b.billType];
      if (!storageType) continue;
      const num = stripBillNum(b.billNumber);
      if (!num) continue;
      const billNumStored = jur === 'CA' ? b.billNumber : num;
      const cosponsorKey = `${jur}|${storageType}|${billNumStored}`;
      const ids = cosponsorsByBill.get(cosponsorKey);
      if (ids) for (const id of ids) aligned.add(id);
    }
    markerSlots.push({
      markerId: m.id,
      plankNumber: m.plank.number,
      jurisdiction: jur,
      alignedLegIds: aligned,
    });
  }
  console.log(
    `[compute-v17] ${markerSlots.length} marker scoring slots loaded (${
      markers.length - markerSlots.length - belowFloorSkipped
    } bill-less markers skipped, ${belowFloorSkipped} below popular-support floor of ${POPULAR_SUPPORT_FLOOR}%)`,
  );

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
      const voted = bill.legsVoted.has(leg.id);
      // Opportunity gate (v1.9.5): only score this bill against the leg if they
      // actually cast a vote on it (proves in-office + had the chance) OR
      // cosponsored it. No vote + no cosponsorship = no opportunity acted on →
      // skip, so a member is never penalized for a vote they could not cast.
      if (!voted && !cosponsored) continue;
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

    // v1.7.1 — marker scoring slots. Cross-chamber: every federal leg is
    // scored on every federal marker (and CA leg on every CA marker), since
    // the marker captures a cross-chamber policy goal even when its specific
    // bills sit in one chamber. Aligned iff the leg sponsored any of the
    // marker's seeded bills.
    for (const slot of markerSlots) {
      if (slot.jurisdiction !== legJur) continue;
      const plankId = plankIdByJurNum.get(`${legJur}|${slot.plankNumber}`);
      if (!plankId) continue;
      const aligned = slot.alignedLegIds.has(leg.id);
      // Opportunity gate (v1.9.5): a marker bill that never reached a roll call
      // gave the member no vote to cast — cosponsorship is the only way to act
      // on it. So it counts ONLY for cosponsors (pure positive credit) and is
      // never charged against a non-cosponsor who had no chance to vote.
      if (!aligned) continue;
      overallTotal += 1;
      overallAligned += 1;
      const cur = perPlank[slot.plankNumber] ?? { aligned: 0, total: 0 };
      cur.total += 1;
      cur.aligned += 1;
      perPlank[slot.plankNumber] = cur;
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
          `v1.7.1: aligned=${row.aligned}, total=${row.total}, percent=${row.percent.toFixed(
            2,
          )} (bill-level: roll-call ∪ cosponsorship ∪ marker-sponsorship)`,
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
