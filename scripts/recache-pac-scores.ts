// v2.0.2 — precompute PAC Scores into Legislator.pacScoreCache.
//
// The index page (getScorecardBase) was aggregating ~1.8M PacContribution rows
// live on every load (getPacScoresByLegislatorV171), which timed out and hung
// /scorecard. PAC scores only change on ingest, so we precompute them here
// (offline, via the direct/session connection with no request-time limits) and
// the index just reads the column. Run after every PAC ingest:
//
//   npm run scorecard:recache-pac
//
// Federal → V171 (itemized PacContribution); CA → legacy PacMoneyData summary,
// exactly mirroring the read paths the pages use.

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPacScoresByLegislatorV171, getPacScoresByLegislator } from '../src/lib/scorecard/queries';

// Direct/session connection — no pooler statement pressure for the heavy query.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
});

async function main(): Promise<void> {
  const legs = await prisma.legislator.findMany({
    where: { isActive: true },
    select: { id: true, jurisdiction: true },
  });
  const federalIds = legs.filter((l) => l.jurisdiction === 'FEDERAL').map((l) => l.id);
  const caIds = legs.filter((l) => l.jurisdiction === 'CA').map((l) => l.id);
  console.log(`[recache] ${legs.length} active legislators (${federalIds.length} federal, ${caIds.length} CA)`);

  // Compute in BATCHES (each query scans only that batch's PacContribution
  // rows, so it stays fast and completes even while production traffic is
  // hammering the DB). Pass our DIRECT client. One giant 538-leg aggregation
  // would starve and hit the statement timeout under load.
  const BATCH = 40;
  const fedScores = new Map<string, number | null>();
  let t = Date.now();
  for (let i = 0; i < federalIds.length; i += BATCH) {
    const chunk = federalIds.slice(i, i + BATCH);
    const m = await getPacScoresByLegislatorV171(chunk, prisma);
    for (const [k, v] of m) fedScores.set(k, v);
    if ((i / BATCH) % 5 === 0)
      console.log(`[recache]   federal ${Math.min(i + BATCH, federalIds.length)}/${federalIds.length}`);
  }
  console.log(`[recache] federal V171 scores computed in ${Date.now() - t}ms`);
  t = Date.now();
  const caScores = new Map<string, number | null>();
  for (let i = 0; i < caIds.length; i += BATCH) {
    const m = await getPacScoresByLegislator(caIds.slice(i, i + BATCH), prisma);
    for (const [k, v] of m) caScores.set(k, v);
  }
  console.log(`[recache] CA legacy scores computed in ${Date.now() - t}ms`);

  const now = new Date();
  let written = 0;
  let nulls = 0;
  for (const leg of legs) {
    const score = leg.jurisdiction === 'FEDERAL' ? fedScores.get(leg.id) ?? null : caScores.get(leg.id) ?? null;
    if (score == null) nulls += 1;
    await prisma.legislator.update({
      where: { id: leg.id },
      data: { pacScoreCache: score, pacScoreCachedAt: now },
    });
    written += 1;
    if (written % 200 === 0) console.log(`[recache]   ${written}/${legs.length}`);
  }
  console.log(`[recache] ✓ wrote pacScoreCache for ${written} legislators (${nulls} null / no PAC data)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
