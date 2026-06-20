// Group the below-0.8 KIE proposals into bulk-approvable buckets:
// (proposedClass x confidence band), with committee count + dollar impact, so
// the reviewer can approve whole groups instead of 600 individual rows.
import './load-env';
import fs from 'fs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const p = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
});
const CA = new Set(['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY', 'LEADERSHIP']);
const confOf = (r: string): number => {
  const m = (r || '').match(/conf=([0-9.]+)/);
  return m ? parseFloat(m[1]) : 0;
};
const band = (c: number): string =>
  c >= 0.7 ? '0.70–0.79' : c >= 0.6 ? '0.60–0.69' : c >= 0.5 ? '0.50–0.59' : c >= 0.4 ? '0.40–0.49' : '<0.40';
(async () => {
  const data: Record<string, { class: string; reason: string }> = JSON.parse(
    fs.readFileSync('data/committee-proposals-batch.json', 'utf-8'),
  );
  const pending = Object.keys(data).filter((id) => data[id].class !== 'UNKNOWN' && confOf(data[id].reason) < 0.8);
  const rows: any = await p.$queryRawUnsafe(
    `SELECT k."donorCommitteeId" cid, COALESCE(SUM(k.amount::numeric),0) amt FROM "PacContribution" k
     WHERE k."donorCommitteeId" = ANY($1::text[]) AND k.kind IN ('DIRECT','JFC_PASS_THROUGH','LEADERSHIP_PASS_THROUGH','IE_SUPPORT','IE_OPPOSE_BENEFICIARY') GROUP BY 1`,
    pending,
  );
  const amt = new Map<string, number>(rows.map((r: any) => [String(r.cid), Number(r.amt)]));
  const names: any = await p.pacClassification.findMany({
    where: { committeeId: { in: pending } },
    select: { committeeId: true, name: true },
  });
  const nm = new Map<string, string>(names.map((n: any) => [String(n.committeeId), String(n.name ?? '')]));
  type G = { n: number; dollars: number; examples: string[] };
  const groups = new Map<string, G>();
  for (const id of pending) {
    const key = `${data[id].class}|${band(confOf(data[id].reason))}`;
    const g = groups.get(key) ?? { n: 0, dollars: 0, examples: [] };
    g.n += 1;
    g.dollars += amt.get(id) ?? 0;
    if (g.examples.length < 3 && nm.get(id)) g.examples.push(nm.get(id)!);
    groups.set(key, g);
  }
  const order = [
    'CORPORATE',
    'DARK_MONEY',
    'LEADERSHIP',
    'FOREIGN_POLICY',
    'ACTIVIST',
    'IDEOLOGICAL',
    'PARTY',
    'LABOR',
  ];
  const bands = ['0.70–0.79', '0.60–0.69', '0.50–0.59', '0.40–0.49', '<0.40'];
  console.log(
    'GROUP'.padEnd(18),
    'CONF'.padEnd(11),
    'CA',
    'CMTES'.padStart(6),
    'DOLLAR IMPACT'.padStart(15),
    '  EXAMPLES',
  );
  let caTot = 0,
    caN = 0;
  for (const cls of order)
    for (const b of bands) {
      const g = groups.get(`${cls}|${b}`);
      if (!g) continue;
      const ca = CA.has(cls);
      if (ca) {
        caTot += g.dollars;
        caN += g.n;
      }
      console.log(
        cls.padEnd(18),
        b.padEnd(11),
        ca ? 'Y ' : 'n ',
        String(g.n).padStart(6),
        ('$' + Math.round(g.dollars).toLocaleString()).padStart(15),
        '  ' + g.examples.slice(0, 3).join('; '),
      );
    }
  console.log(`\nCounts-against pending total: ${caN} committees, $${Math.round(caTot).toLocaleString()}`);
  await p.$disconnect();
})().catch((e) => console.error('ERR', e.message));
