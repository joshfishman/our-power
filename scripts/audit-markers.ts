// TEMP read-only: is the marker/bill set Republican-earnable, or D-coded?
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }) });

async function main() {
  const planks = await prisma.plank.findMany({ where: { jurisdiction: 'FEDERAL' }, select: { number: true, name: true } });
  const plankName = new Map(planks.map((p) => [p.number, p.name]));

  // Markers per plank + Option-C (Republican alternative) count.
  const markers = await prisma.marker.findMany({
    select: { isRepublicanAlternative: true, bills: { select: { id: true } }, plank: { select: { number: true, jurisdiction: true } } },
  });
  const mByPlank = new Map<number, { total: number; ralt: number; withBills: number }>();
  for (const m of markers) {
    if (m.plank.jurisdiction !== 'FEDERAL') continue;
    const c = mByPlank.get(m.plank.number) ?? { total: 0, ralt: 0, withBills: 0 };
    c.total++; if (m.isRepublicanAlternative) c.ralt++; if (m.bills.length > 0) c.withBills++;
    mByPlank.set(m.plank.number, c);
  }

  // Party of every legislator.
  const legs = await prisma.legislator.findMany({ select: { id: true, party: true } });
  const party = new Map(legs.map((l) => [l.id, l.party]));

  // Scorable plank votes with positions → per vote, share of Republicans who voted aligned.
  const votes = await prisma.rollCallVote.findMany({
    where: { isScorable: true, alignedPosition: { not: null }, plankNumbers: { isEmpty: false } },
    select: { chamber: true, billType: true, billNumber: true, plankNumbers: true, alignedPosition: true, positions: { select: { legislatorId: true, position: true } } },
  });
  // Dedup to bill; keep the MAX R-aligned share across its roll calls (most generous to R).
  const billBest = new Map<string, { planks: number[]; rShare: number }>();
  for (const v of votes) {
    let rA = 0, rT = 0;
    for (const p of v.positions) {
      if (party.get(p.legislatorId) !== 'R') continue;
      rT++; if (p.position === v.alignedPosition) rA++;
    }
    const share = rT > 0 ? rA / rT : 0;
    const key = `${v.chamber}|${v.billType}|${v.billNumber}`;
    const prev = billBest.get(key);
    if (!prev || share > prev.rShare) billBest.set(key, { planks: v.plankNumbers, rShare: share });
  }

  // Per-plank bucketing of bills by R-earnability.
  const bucket = new Map<number, { rEarnable: number; lean: number; dOnly: number; shareSum: number; n: number }>();
  for (const b of billBest.values()) {
    for (const pn of b.planks) {
      const c = bucket.get(pn) ?? { rEarnable: 0, lean: 0, dOnly: 0, shareSum: 0, n: 0 };
      if (b.rShare >= 0.5) c.rEarnable++; else if (b.rShare >= 0.2) c.lean++; else c.dOnly++;
      c.shareSum += b.rShare; c.n++;
      bucket.set(pn, c);
    }
  }

  console.log('Per federal plank — markers and bill R-earnability:');
  console.log('(R-earnable = a majority of voting Republicans voted the aligned way; D-only = <20% of Rs did)\n');
  for (const pn of [1, 2, 3, 4, 5]) {
    const m = mByPlank.get(pn) ?? { total: 0, ralt: 0, withBills: 0 };
    const b = bucket.get(pn) ?? { rEarnable: 0, lean: 0, dOnly: 0, shareSum: 0, n: 0 };
    console.log(`P${pn} ${plankName.get(pn)}`);
    console.log(`   markers: ${m.total} (Option-C/R-alt: ${m.ralt})`);
    console.log(`   scorable bills: ${b.n}  →  R-earnable: ${b.rEarnable}  ·  lean: ${b.lean}  ·  D-only: ${b.dOnly}  ·  avg R-aligned share: ${b.n ? Math.round((b.shareSum / b.n) * 100) : 0}%`);
  }
  // Totals
  const allM = [...mByPlank.values()].reduce((a, c) => ({ total: a.total + c.total, ralt: a.ralt + c.ralt }), { total: 0, ralt: 0 });
  const allB = [...bucket.values()].reduce((a, c) => ({ rE: a.rE + c.rEarnable, lean: a.lean + c.lean, d: a.d + c.dOnly, n: a.n + c.n }), { rE: 0, lean: 0, d: 0, n: 0 });
  console.log(`\nTOTAL markers: ${allM.total}  (Option-C: ${allM.ralt} = ${Math.round(allM.ralt / allM.total * 100)}%)`);
  console.log(`TOTAL scorable bills: ${allB.n}  →  R-earnable: ${allB.rE} (${Math.round(allB.rE / allB.n * 100)}%) · lean: ${allB.lean} · D-only: ${allB.d} (${Math.round(allB.d / allB.n * 100)}%)`);
  console.log(`\nImplied R voting ceiling (if an R voted aligned on every R-earnable+lean bill): ~${Math.round((allB.rE + allB.lean) / allB.n * 100)}%`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
