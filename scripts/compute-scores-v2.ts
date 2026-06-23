// compute-scores-v2.ts — HYBRID voting score (v2.0).
//
// Replaces the v1.7.x auto-classified 521-bill roll-call net (the source of the
// "everyone's at 100" problem) with a small, human-CURATED set of substantive
// bills, scored on the model the project settled on:
//
//   Per plank, for each legislator:
//     denominator = (curated vote-bills they VOTED on)  +  (markers they COSPONSORED)
//     numerator   = (curated votes that were ALIGNED)   +  (markers they COSPONSORED)
//     plank %     = numerator / denominator * 100
//
//   • A VOTE is the scored signal: a misaligned vote on a curated bill counts
//     against the legislator (it lands in the denominator, not the numerator).
//   • COSPONSORSHIP is bonus-only: a cosponsored marker adds to BOTH num and
//     denom (pure positive credit). NOT cosponsoring is never a penalty — the
//     marker simply isn't counted. This also disposes of the old historical-
//     marker "opportunity" problem and the GOP-alternative double-count, since
//     absence is never charged.
//
// Curated vote-bills carry their OWN aligned direction (human-reviewed) — the
// DB's auto-classified alignedPosition is ignored for these (it was wrong for
// HR4758 and null for HR498).
//
// Markers keep the v1.9.2 popular-support floor. Bill-less markers (PAC refusal)
// stay with the PAC score. CA legislators currently have no curated vote-bills,
// so they score on CA markers alone until a CA vote set is curated.
//
// Usage:
//   npx tsx scripts/compute-scores-v2.ts            # compute + print marquee, NO write
//   npx tsx scripts/compute-scores-v2.ts --write     # write v2.0 rows (unpublished)
//   npx tsx scripts/compute-scores-v2.ts --write --publish

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CURATED_VOTE_BILLS, isCuratedVoteBill } from '../src/lib/scorecard/curated-votes';

const url = new URL(process.env.DATABASE_URL!);
if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });

const METHODOLOGY_VERSION = 'v2.0';
const POPULAR_SUPPORT_FLOOR = 55;

// Curated vote-bills live in src/lib/scorecard/curated-votes.ts (shared with the
// read-time bill breakdown so displayed bills always match the scored basis).

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
const stripNum = (raw: string): string | null => raw.match(/\d+/)?.[0] ?? null;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doWrite = args.includes('--write');
  const doPublish = args.includes('--publish');

  // 1. Curated vote-bills → who voted / who voted aligned, keyed by (chamber, type, num).
  //    Use the MOST RECENT passage vote per (chamber, bill) so multi-vote bills
  //    (e.g. HR1 passage + concurrence) count once.
  // Multi-Congress: match curated bills by (congress, type, number).
  const billKeys = CURATED_VOTE_BILLS.map((b) => ({
    congressNumber: b.congress,
    billType: b.billType,
    billNumber: b.billNumber,
  }));
  const votes = await prisma.rollCallVote.findMany({
    where: { OR: billKeys },
    select: {
      congressNumber: true,
      chamber: true,
      billType: true,
      billNumber: true,
      rollCallNumber: true,
      voteQuestion: true,
      positions: { select: { legislatorId: true, position: true } },
    },
  });
  // Pick the final-passage roll call per (congress, chamber, bill): exclude
  // clearly-procedural questions, then take the most-cast YES/NO vote. Exclusion
  // (not keyword inclusion) is required because the Senate labels some passage
  // votes just "On the Motion" (CHIPS, PACT).
  const PROCEDURAL =
    /cloture|motion to proceed|recommit|reconsider|motion to table|previous question|quorum|adjourn|motion to refer|motion to instruct|motion to commit|on the amendment/i;
  const passageByCb = new Map<string, typeof votes>();
  for (const v of votes) {
    if (PROCEDURAL.test(v.voteQuestion || '')) continue;
    const cb = `${v.congressNumber}|${v.chamber}|${v.billType}|${v.billNumber}`;
    (passageByCb.get(cb) ?? passageByCb.set(cb, []).get(cb)!).push(v);
  }
  const castCount = (v: (typeof votes)[number]): number =>
    v.positions.filter((p) => p.position === 'YES' || p.position === 'NO').length;
  const voteData = new Map<string, { voted: Set<string>; aligned: Set<string> }>();
  for (const [cb, vs] of passageByCb) {
    const v = vs.reduce((best, cur) => (castCount(cur) > castCount(best) ? cur : best));
    const curated = CURATED_VOTE_BILLS.find(
      (c) => c.congress === v.congressNumber && c.billType === v.billType && c.billNumber === v.billNumber,
    );
    if (!curated) continue;
    const entry = { voted: new Set<string>(), aligned: new Set<string>() };
    for (const pos of v.positions) {
      // Only a cast YES/NO is a real position. NOT_VOTING / PRESENT / absent is
      // not a vote — it must never penalize (would otherwise read as misaligned).
      if (pos.position !== 'YES' && pos.position !== 'NO') continue;
      entry.voted.add(pos.legislatorId);
      if (pos.position === curated.aligned) entry.aligned.add(pos.legislatorId);
    }
    voteData.set(cb, entry);
  }

  // 2. Markers (bonus-only cosponsorship) — same loading as v1.7, popular-support floored.
  const markers = await prisma.marker.findMany({
    include: {
      plank: { select: { number: true, jurisdiction: true } },
      bills: {
        select: {
          congressNumber: true,
          billType: true,
          billNumber: true,
          sponsorships: { select: { legislatorId: true } },
        },
      },
    },
  });
  const cosponsorRows = await prisma.billCosponsor.findMany({
    select: { jurisdiction: true, billType: true, billNumber: true, legislatorId: true },
  });
  const cosponsorsByBill = new Map<string, Set<string>>();
  for (const c of cosponsorRows) {
    const k = `${c.jurisdiction}|${c.billType}|${c.billNumber}`;
    (cosponsorsByBill.get(k) ?? cosponsorsByBill.set(k, new Set()).get(k)!).add(c.legislatorId);
  }
  interface MarkerSlot {
    plankNumber: number;
    jurisdiction: string;
    aligned: Set<string>;
  }
  const markerSlots: MarkerSlot[] = [];
  for (const m of markers) {
    if (m.bills.length === 0) continue;
    if (m.popularSupport != null && Number(m.popularSupport) < POPULAR_SUPPORT_FLOOR) continue;
    const jur = m.plank.jurisdiction;
    const aligned = new Set<string>();
    let countedBills = 0;
    for (const b of m.bills) {
      const storageType = STORAGE_TYPE_MAP[b.billType];
      if (!storageType) continue;
      const num = stripNum(b.billNumber);
      if (!num) continue;
      // Dedup: a bill that is ALSO a curated vote-bill is scored by the vote
      // layer — don't double-count it here as cosponsorship bonus.
      if (b.congressNumber != null && isCuratedVoteBill(b.congressNumber, storageType, num)) continue;
      countedBills += 1;
      for (const s of b.sponsorships) aligned.add(s.legislatorId);
      const billNumStored = jur === 'CA' ? b.billNumber : num;
      const ids = cosponsorsByBill.get(`${jur}|${storageType}|${billNumStored}`);
      if (ids) for (const id of ids) aligned.add(id);
    }
    if (countedBills === 0) continue; // marker fully represented by the vote layer
    markerSlots.push({ plankNumber: m.plank.number, jurisdiction: jur, aligned });
  }

  // 3. Score each active legislator.
  const legs = await prisma.legislator.findMany({
    where: { isActive: true },
    select: { id: true, jurisdiction: true, chamber: true, fullName: true, party: true },
  });
  const planks = await prisma.plank.findMany({ select: { id: true, number: true, jurisdiction: true } });
  const plankId = new Map<string, string>();
  for (const pl of planks) plankId.set(`${pl.jurisdiction}|${pl.number}`, pl.id);

  interface Row {
    legislatorId: string;
    plankId: string;
    score: number;
    aligned: number;
    total: number;
  }
  const rows: Row[] = [];
  const overall = new Map<
    string,
    {
      sum: number;
      n: number;
      per: Record<number, [number, number]>;
      fullName: string;
      party: string;
      chamber: string;
      jur: string;
    }
  >();

  for (const leg of legs) {
    const jur = leg.jurisdiction;
    const chamber = leg.chamber === 'SEN' ? 'SENATE' : 'HOUSE';
    const per: Record<number, { a: number; t: number }> = {};

    // Vote layer (federal curated bills; CA has none yet).
    if (jur === 'FEDERAL') {
      for (const cb of CURATED_VOTE_BILLS) {
        const entry = voteData.get(`${cb.congress}|${chamber}|${cb.billType}|${cb.billNumber}`);
        if (!entry || !entry.voted.has(leg.id)) continue; // vote-gated: no vote, no count
        (per[cb.plank] ??= { a: 0, t: 0 }).t += 1;
        if (entry.aligned.has(leg.id)) per[cb.plank].a += 1;
      }
    }
    // Marker bonus layer.
    for (const slot of markerSlots) {
      if (slot.jurisdiction !== jur) continue;
      if (!slot.aligned.has(leg.id)) continue; // bonus-only: not cosponsored → not counted
      (per[slot.plankNumber] ??= { a: 0, t: 0 }).t += 1;
      per[slot.plankNumber].a += 1;
    }

    const acc = {
      sum: 0,
      n: 0,
      per: {} as Record<number, [number, number]>,
      fullName: leg.fullName,
      party: leg.party,
      chamber: leg.chamber,
      jur,
    };
    for (const [pnStr, v] of Object.entries(per)) {
      const pn = Number(pnStr);
      const pid = plankId.get(`${jur}|${pn}`);
      if (!pid || v.t === 0) continue;
      const score = Math.round((100 * v.a) / v.t);
      rows.push({ legislatorId: leg.id, plankId: pid, score, aligned: v.a, total: v.t });
      acc.sum += score;
      acc.n += 1;
      acc.per[pn] = [v.a, v.t];
    }
    overall.set(leg.id, acc);
  }

  // 4. Coverage + marquee.
  console.log(`[v2] curated vote-bills with positions: ${voteData.size} · marker slots: ${markerSlots.length}`);
  console.log(`[v2] per-plank rows: ${rows.length} across ${overall.size} legislators`);
  const marquee = [
    'Sanders',
    'Warren',
    'Ocasio',
    'Pelosi',
    'Jeffries',
    'Schumer',
    'Hawley',
    'Cruz',
    'Jordan',
    'Greene',
    'McConnell',
  ];
  console.log('\nMARQUEE (overall = mean of plank %; Pn=aligned/total):');
  for (const nm of marquee) {
    const e = [...overall.values()].find((x) => x.fullName.includes(nm));
    if (!e) continue;
    const ov = e.n ? Math.round(e.sum / e.n) : null;
    const cells = Object.entries(e.per)
      .map(([pn, [a, t]]) => `P${pn}=${Math.round((100 * a) / t)}(${a}/${t})`)
      .join(' ');
    console.log(
      `  ${String(ov).padStart(4)}  ${(e.fullName + ' (' + e.party + '/' + e.chamber + ')').padEnd(30)} ${cells}`,
    );
  }

  if (!doWrite) {
    console.log('\n[v2] no --write flag — nothing written.');
    await prisma.$disconnect();
    return;
  }

  // 5. Write v2.0 rows.
  const now = new Date();
  await prisma.representativeScore.deleteMany({ where: { methodologyVersion: METHODOLOGY_VERSION } });
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await prisma.representativeScore.createMany({
      data: chunk.map((r) => ({
        legislatorId: r.legislatorId,
        plankId: r.plankId,
        score: r.score,
        forCount: r.aligned,
        againstCount: r.total - r.aligned,
        methodologyVersion: METHODOLOGY_VERSION,
        publishedAt: doPublish ? now : null,
        notes: 'hybrid: curated votes + cosponsorship-bonus markers',
      })),
      skipDuplicates: true,
    });
    written += chunk.length;
  }
  console.log(`\n[v2] wrote ${written} rows as ${METHODOLOGY_VERSION}${doPublish ? ' (published)' : ' (unpublished)'}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
