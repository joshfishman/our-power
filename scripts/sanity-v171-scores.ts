// One-shot sanity check: pull v1.7.1 PAC scores for the marquee names
// (Scalise, Issa, Massie, Kim NJ, Markey, Booker, Sanders, AOC) and compare
// to the spike numbers the user has seen. Use the PRODUCTION query helpers
// so we're actually verifying what the page will render.
//
// Run:
//   npx tsx scripts/sanity-v171-scores.ts

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// The helpers import from '@/lib/prisma/prisma' which uses the global Prisma
// client. We point that to OUR client here by setting it on global before
// the import.
(globalThis as unknown as { prisma?: unknown }).prisma = prisma;

import { getPacScoresByLegislatorV171, getLegislatorMoneyTrail } from '../src/lib/scorecard/queries';

const MARQUEE = [
  { name: 'Scalise', spike: 51 },
  { name: 'Issa', spike: 58 },
  { name: 'Massie', spike: 78 },
  { name: 'Kim', spike: 86, state: 'NJ' },
  { name: 'Markey', spike: 89 },
  { name: 'Booker', spike: 97 },
  { name: 'Sanders', spike: 100 },
  { name: 'Ocasio', spike: 100 },
];

async function main(): Promise<void> {
  const rows = [];
  for (const m of MARQUEE) {
    const leg = await prisma.legislator.findFirst({
      where: {
        lastName: { contains: m.name, mode: 'insensitive' },
        ...(m.state ? { state: m.state } : {}),
        isActive: true,
        jurisdiction: 'FEDERAL',
      },
      select: { id: true, fullName: true, state: true, chamber: true, party: true },
    });
    if (!leg) {
      console.log(`  [skip] ${m.name} — not found`);
      continue;
    }
    rows.push({ leg, spike: m.spike });
  }

  const scoreMap = await getPacScoresByLegislatorV171(rows.map((r) => r.leg.id));

  console.log('Marquee v1.7.1 sanity:');
  console.log('Name                         Live   Spike  Δ');
  for (const r of rows) {
    const trail = await getLegislatorMoneyTrail(r.leg.id);
    const live = scoreMap.get(r.leg.id);
    const delta = live !== null && live !== undefined ? live - r.spike : NaN;
    const tag = `${r.leg.fullName} (${r.leg.party}-${r.leg.state})`.padEnd(28);
    const liveStr = live !== null && live !== undefined ? `${live}%`.padStart(5) : '   — ';
    const spikeStr = `${r.spike}%`.padStart(5);
    const deltaStr = Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta}` : '—';
    console.log(`${tag} ${liveStr}  ${spikeStr}  ${deltaStr}`);
    console.log(
      `  receipts=$${(trail.totalReceipts / 1000).toFixed(0)}K  ie_support=$${(trail.ieSupportTotal / 1000).toFixed(
        0,
      )}K  counts_against=$${(trail.countsAgainst / 1000).toFixed(0)}K  denom=$${(trail.denominator / 1000).toFixed(
        0,
      )}K`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
