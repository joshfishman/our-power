import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const p = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
});
const KEY = process.env.FEC_API_KEY!;
const FLOOR = 5000; // capture a money figure for most; viability threshold applied later in the page
async function fetchPage(office: string, n: number) {
  const u = `https://api.open.fec.gov/v1/candidates/totals/?api_key=${KEY}&cycle=2026&office=${office}&per_page=100&page=${n}&sort=-receipts`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`FEC ${r.status} ${office} p${n}`);
  return r.json() as any;
}
(async () => {
  const legs: any = await p.$queryRawUnsafe(`select id,"fecIds" from "Legislator" where "currentCandidateCycle"=2026`);
  const byFec = new Map<string, string>();
  for (const l of legs) for (const f of l.fecIds || []) byFec.set(f, l.id);
  let updated = 0;
  for (const office of ['H', 'S']) {
    let pg = 1,
      pages = 1,
      stop = false;
    do {
      const j = await fetchPage(office, pg);
      pages = j.pagination.pages;
      for (const row of j.results) {
        const rec = Math.round(row.receipts || 0);
        if (rec < FLOOR) {
          stop = true;
          break;
        }
        const lid = byFec.get(row.candidate_id);
        if (!lid) continue;
        await p.legislator
          .update({ where: { id: lid }, data: { currentCycleReceipts: rec } })
          .then(() => updated++)
          .catch(() => {});
      }
      pg++;
      await new Promise((r) => setTimeout(r, 120));
    } while (pg <= pages && !stop);
    console.log(`${office}: stopped page ${pg - 1}/${pages}, updated=${updated}`);
  }
  console.log(`DONE updated=${updated}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
