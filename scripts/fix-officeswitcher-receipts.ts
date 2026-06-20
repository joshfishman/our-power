import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const p = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
});
const KEY = process.env.FEC_API_KEY!;
(async () => {
  const legs = await p.legislator.findMany({
    where: { currentCandidateCycle: 2026, isActive: true, currentCycleReceipts: null },
    select: { id: true, lastName: true, firstName: true, state: true, fecIds: true },
  });
  console.log(`${legs.length} office-switcher candidates with null receipts`);
  for (const l of legs) {
    // their NEW race is Senate (House members running for Senate); search FEC Senate 2026 by state + name
    const url = `https://api.open.fec.gov/v1/candidates/totals/?api_key=${KEY}&cycle=2026&office=S&state=${
      l.state
    }&q=${encodeURIComponent(l.lastName)}&per_page=5&sort=-receipts`;
    try {
      const r = await fetch(url);
      const j: any = await r.json();
      const cand = (j.results || []).find((c: any) =>
        String(c.name || '')
          .toUpperCase()
          .includes(l.lastName.toUpperCase()),
      );
      if (!cand) {
        console.log(`  ${l.lastName}: no FEC Senate match`);
        continue;
      }
      const receipts = Math.round(cand.receipts || 0);
      const newFecIds = Array.from(new Set([...(l.fecIds || []), cand.candidate_id]));
      await p.legislator.update({ where: { id: l.id }, data: { currentCycleReceipts: receipts, fecIds: newFecIds } });
      console.log(`  ${l.lastName} → ${cand.candidate_id} $${(receipts / 1e6).toFixed(1)}M (linked)`);
    } catch (e: any) {
      console.log(`  ${l.lastName}: ERR ${e.message?.slice(0, 40)}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  await p.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
