// Read-only spot-check (standing tool): v0.9 voting + fixed PAC + overall, marquee + extremes.
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }) });
const MONEY = ['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY', 'TRADE_ASSOCIATION', 'PARTY', 'LEADERSHIP', 'IDEOLOGICAL', 'CONDUIT', 'UNKNOWN'];

async function main() {
  const legs = await prisma.legislator.findMany({
    where: { isActive: true, jurisdiction: 'FEDERAL' },
    select: { id: true, fullName: true, party: true, chamber: true },
  });
  const legById = new Map(legs.map((l) => [l.id, l]));

  // PAC pieces per legislator (new MONEY bucket + beneficiary).
  const agg = await prisma.$queryRawUnsafe<Array<{ legislatorId: string; ca: number; benef: number; ie: number }>>(
    `SELECT pcontrib."legislatorId" AS "legislatorId",
       COALESCE(SUM(CASE WHEN pc.class::text = ANY($1) AND pcontrib.kind IN ('DIRECT','JFC_PASS_THROUGH','LEADERSHIP_PASS_THROUGH','IE_SUPPORT') THEN pcontrib.amount::numeric ELSE 0 END),0)::float AS ca,
       COALESCE(SUM(CASE WHEN pc.class::text = ANY($1) AND pcontrib.kind='IE_OPPOSE_BENEFICIARY' THEN pcontrib.amount::numeric ELSE 0 END),0)::float AS benef,
       COALESCE(SUM(CASE WHEN pcontrib.kind='IE_SUPPORT' THEN pcontrib.amount::numeric ELSE 0 END),0)::float AS ie
     FROM "PacContribution" pcontrib JOIN "PacClassification" pc ON pc."committeeId"=pcontrib."donorCommitteeId"
     GROUP BY pcontrib."legislatorId"`, MONEY);
  const aggById = new Map(agg.map((a) => [a.legislatorId, a]));
  const recRows = await prisma.$queryRawUnsafe<Array<{ legislatorId: string; r: number }>>(
    `SELECT "legislatorId", COALESCE(SUM("totalReceipts"::numeric),0)::float r FROM "PacMoneyData" GROUP BY "legislatorId"`);
  const recById = new Map(recRows.map((r) => [r.legislatorId, r.r]));

  // Voting (mean of v0.9 plank scores) + denominator (total bills across planks).
  const scores = await prisma.representativeScore.findMany({
    where: { methodologyVersion: 'v0.9', publishedAt: { not: null } },
    select: { legislatorId: true, score: true, forCount: true, againstCount: true },
  });
  const vby = new Map<string, { sum: number; n: number; bills: number }>();
  for (const s of scores) {
    const c = vby.get(s.legislatorId) ?? { sum: 0, n: 0, bills: 0 };
    c.sum += s.score; c.n += 1; c.bills += s.forCount + s.againstCount;
    vby.set(s.legislatorId, c);
  }

  function pacOf(id: string): number | null {
    const a = aggById.get(id); const receipts = recById.get(id) ?? 0;
    if (!a) return receipts > 0 ? 100 : null;
    if (receipts <= 0 && a.ca > 0) return null;
    const denom = receipts + a.ie + a.benef;
    return denom > 0 ? Math.max(0, Math.min(100, Math.round((1 - (a.ca + a.benef) / denom) * 100))) : null;
  }
  function row(id: string) {
    const l = legById.get(id)!; const v = vby.get(id);
    const voting = v ? Math.round(v.sum / v.n) : null;
    const pac = pacOf(id);
    // v0.9 overall rule (matches computeTwoScoreAverage in queries.ts):
    // no voting record → no overall (PAC alone is not an overall score);
    // no PAC data + voting present → overall = voting.
    const overall = voting == null ? null : pac == null ? voting : Math.round((pac + voting) / 2);
    return { name: l.fullName, party: l.party, chamber: l.chamber, voting, bills: v?.bills ?? 0, pac, overall };
  }
  const fmt = (r: ReturnType<typeof row>) =>
    `  ${(r.party + '-' + r.chamber).padEnd(6)} ${r.name.padEnd(26)} vote=${String(r.voting ?? '—').padStart(4)}% (${String(r.bills).padStart(3)} bills)  PAC=${String(r.pac ?? '—').padStart(4)}%  overall=${String(r.overall ?? '—').padStart(4)}%`;

  const marquee = ['Sanders', 'Warren', 'Ocasio-Cortez', 'Pelosi', 'Schumer', 'Manchin', 'Hawley', 'Cruz', 'McConnell', 'Paul', 'Collins', 'Greene'];
  console.log('MARQUEE:');
  for (const nm of marquee) {
    const l = legs.find((x) => x.fullName.includes(nm));
    if (l) console.log(fmt(row(l.id)));
  }
  const all = legs.map((l) => row(l.id)).filter((r) => r.overall != null).sort((a, b) => b.overall! - a.overall!);
  console.log('\nTOP 8 overall:'); all.slice(0, 8).forEach((r) => console.log(fmt(r)));
  console.log('\nBOTTOM 8 overall:'); all.slice(-8).forEach((r) => console.log(fmt(r)));
}
main().catch(console.error).finally(() => prisma.$disconnect());
