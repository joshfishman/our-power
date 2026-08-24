// scripts/publish-v1.7.ts
//
// Publishes the pre-existing v1.7 bill-level alignment-% RepresentativeScore
// rows so the public Voting Record can read them.
//
// Background: the public Voting Record (src/lib/scorecard/queries.ts) was
// reading signed-integer score rows written under the PAC/scoring engine's
// PLANK_ENGINE_VERSION (v1.9.1) and averaging them through computePublishedTotal's
// [0,100] heuristic, which collapsed every legislator to ~4%. The correct
// 0-100 alignment percentages already exist under methodologyVersion 'v1.7'
// (~3070 rows, all 658 legislators) but were never published. The display has
// been repointed to read v1.7 (VOTING_DISPLAY_METHODOLOGY); this script flips
// publishedAt on those rows so they actually surface.
//
// This is a one-shot ops script. It is idempotent (only touches rows with
// publishedAt = null) and reversible. It does NOT recompute or touch any PAC
// data — the PAC Score is computed separately at read time.
//
// Usage:
//   npx tsx scripts/publish-v1.7.ts

import './load-env';

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const result = await prisma.representativeScore.updateMany({
    where: { methodologyVersion: 'v1.7', publishedAt: null },
    data: { publishedAt: new Date() },
  });
  console.log(`Published ${result.count} v1.7 RepresentativeScore rows.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
