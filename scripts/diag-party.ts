// Read-only diagnostic (standing tool): Pelosi PAC breakdown + party distribution of v0.9 scores.
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }) });
const MONEY = ['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY', 'TRADE_ASSOCIATION', 'PARTY', 'LEADERSHIP', 'IDEOLOGICAL', 'CONDUIT', 'UNKNOWN'];
const BEHALF = ['DIRECT', 'JFC_PASS_THROUGH', 'LEADERSHIP_PASS_THROUGH', 'IE_SUPPORT'];

async function main() {
  // ---- Pelosi breakdown ----
  // Non-fatal: a failure here (legislator missing, empty PAC data → null
  // derefs) must not kill the party-distribution section below, which is the
  // half we actually read after every recompute.
  try {
    const pelosi = await prisma.legislator.findFirst({ where: { lastName: 'Pelosi' }, select: { id: true, fullName: true } });
    if (!pelosi) throw new Error('Pelosi not found among legislators');
    const rows = await prisma.$queryRawUnsafe<Array<{ c: string; k: string; a: number }>>(
      `SELECT pc.class::text c, pcontrib.kind::text k, SUM(pcontrib.amount::numeric)::float a FROM "PacContribution" pcontrib JOIN "PacClassification" pc ON pc."committeeId"=pcontrib."donorCommitteeId" WHERE pcontrib."legislatorId"=$1 GROUP BY pc.class,pcontrib.kind ORDER BY a DESC`, pelosi.id);
    const rec = await prisma.$queryRawUnsafe<Array<{ r: number }>>(`SELECT COALESCE(SUM("totalReceipts"::numeric),0)::float r FROM "PacMoneyData" WHERE "legislatorId"=$1`, pelosi.id);
    const receipts = rec[0]?.r ?? 0;
    let ca = 0, benef = 0, ie = 0;
    console.log(`PELOSI money (receipts=$${Math.round(receipts).toLocaleString()}):`);
    for (const r of rows) {
      if (r.k === 'IE_SUPPORT') ie += r.a;
      if (MONEY.includes(r.c) && BEHALF.includes(r.k)) ca += r.a;
      if (MONEY.includes(r.c) && r.k === 'IE_OPPOSE_BENEFICIARY') benef += r.a;
      if (r.a > 50000) console.log(`  ${r.c.padEnd(18)}${r.k.padEnd(22)}$${Math.round(r.a).toLocaleString()}`);
    }
    const denom = receipts + ie + benef;
    if (denom > 0) {
      console.log(`  counts-against=$${Math.round(ca + benef).toLocaleString()}  denom=$${Math.round(denom).toLocaleString()}  PAC=${Math.round((1 - (ca + benef) / denom) * 100)}%`);
    } else {
      console.log('  no PAC denominator (no receipts/IE data) — PAC score undefined');
    }
    // Leadership PACs she controls (money she raises + distributes, NOT in her score)
    const lpacs = await prisma.pacClassification.count({ where: { affiliatedLegislatorId: pelosi.id } });
    console.log(`  leadership/affiliated committees she controls: ${lpacs} (their inflows are NOT in her score)`);
  } catch (err) {
    console.error('Pelosi breakdown failed (continuing to party distribution):', err);
  }

  // ---- Party distribution ----
  const legs = await prisma.legislator.findMany({ where: { isActive: true, jurisdiction: 'FEDERAL' }, select: { id: true, fullName: true, party: true } });
  const agg = await prisma.$queryRawUnsafe<Array<{ legislatorId: string; ca: number; benef: number; ie: number }>>(
    `SELECT pcontrib."legislatorId" AS "legislatorId",
       COALESCE(SUM(CASE WHEN pc.class::text=ANY($1) AND pcontrib.kind IN ('DIRECT','JFC_PASS_THROUGH','LEADERSHIP_PASS_THROUGH','IE_SUPPORT') THEN pcontrib.amount::numeric ELSE 0 END),0)::float ca,
       COALESCE(SUM(CASE WHEN pc.class::text=ANY($1) AND pcontrib.kind='IE_OPPOSE_BENEFICIARY' THEN pcontrib.amount::numeric ELSE 0 END),0)::float benef,
       COALESCE(SUM(CASE WHEN pcontrib.kind='IE_SUPPORT' THEN pcontrib.amount::numeric ELSE 0 END),0)::float ie
     FROM "PacContribution" pcontrib JOIN "PacClassification" pc ON pc."committeeId"=pcontrib."donorCommitteeId" GROUP BY pcontrib."legislatorId"`, MONEY);
  const aggBy = new Map(agg.map((a) => [a.legislatorId, a]));
  const recAll = await prisma.$queryRawUnsafe<Array<{ legislatorId: string; r: number }>>(`SELECT "legislatorId", COALESCE(SUM("totalReceipts"::numeric),0)::float r FROM "PacMoneyData" GROUP BY "legislatorId"`);
  const recBy = new Map(recAll.map((r) => [r.legislatorId, r.r]));
  const scores = await prisma.representativeScore.findMany({ where: { methodologyVersion: 'v0.9', publishedAt: { not: null } }, select: { legislatorId: true, score: true } });
  const vBy = new Map<string, { s: number; n: number }>();
  for (const s of scores) { const c = vBy.get(s.legislatorId) ?? { s: 0, n: 0 }; c.s += s.score; c.n++; vBy.set(s.legislatorId, c); }
  function pac(id: string): number | null { const a = aggBy.get(id); const r = recBy.get(id) ?? 0; if (!a) return r > 0 ? 100 : null; if (r <= 0 && a.ca > 0) return null; const d = r + a.ie + a.benef; return d > 0 ? Math.max(0, Math.min(100, Math.round((1 - (a.ca + a.benef) / d) * 100))) : null; }
  const out: Array<{ name: string; party: string; ov: number }> = [];
  // v0.9 overall rule (matches computeTwoScoreAverage): no voting record →
  // no overall (PAC alone never ranks); no PAC + voting → overall = voting.
  for (const l of legs) { const v = vBy.get(l.id); const vt = v ? Math.round(v.s / v.n) : null; const pc = pac(l.id); const ov = vt == null ? null : pc == null ? vt : Math.round((pc + vt) / 2); if (ov != null) out.push({ name: l.fullName, party: l.party, ov }); }
  const byParty: Record<string, number[]> = {};
  for (const r of out) (byParty[r.party] ??= []).push(r.ov);
  const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  console.log('\nOVERALL by party (avg / n):');
  for (const p of Object.keys(byParty)) console.log(`  ${p}: avg=${avg(byParty[p])}%  n=${byParty[p].length}`);
  const sorted = out.sort((a, b) => b.ov - a.ov);
  console.log('\nBest 6 Republicans:'); sorted.filter((r) => r.party === 'R').slice(0, 6).forEach((r) => console.log(`  ${r.name} — ${r.ov}%`));
  const top50 = sorted.slice(0, 50);
  console.log(`\nParty mix of TOP 50 overall: ` + JSON.stringify(top50.reduce((m: Record<string, number>, r) => ({ ...m, [r.party]: (m[r.party] || 0) + 1 }), {})));
}
main().catch(console.error).finally(() => prisma.$disconnect());
