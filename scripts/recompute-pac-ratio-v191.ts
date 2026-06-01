// scripts/recompute-pac-ratio-v191.ts
//
// v1.9.1 one-shot: recompute `combinedCorporateRatio` on every existing
// `PacMoneyData` row using the v1.9.1 three-tier outside-money formula:
//
//   ratio = (corporatePacAmount + 0.5 * corporateIeSupportAmount)
//           / (totalReceipts + 0.5 * corporateIeSupportAmount)
//
// IE_SUPPORT (Tier 2) counts at 50% in both numerator and denominator.
// IE_OPPOSE_BENEFICIARY (Tier 3, stored in corporateIeAgainstOpponentAmount)
// drops to 0% weight — the legislator could not refuse spending against
// their opponent.
//
// Idempotent. Safe to re-run. Use after pulling the methodology change but
// before `npm run scorecard:compute -- --publish`.
//
// Usage:
//   npx tsx scripts/recompute-pac-ratio-v191.ts
//   npx tsx scripts/recompute-pac-ratio-v191.ts --dry-run

import './load-env';

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[recompute-pac-ratio-v191] dryRun=${dryRun}`);

  // Count rows first so the operator sees the blast radius.
  const totalRows = await prisma.pacMoneyData.count({ where: { dataSource: 'FEC_DIRECT' } });
  console.log(`[recompute-pac-ratio-v191] ${totalRows} FEC_DIRECT PacMoneyData rows`);

  if (dryRun) {
    // Sample what the change would do on the marquee cohort.
    const sample = await prisma.$queryRaw<
      Array<{
        bioguideId: string;
        cycleYear: number;
        before: string | null;
        after: string | null;
      }>
    >`
      SELECT
        l."bioguideId" AS "bioguideId",
        p."cycleYear" AS "cycleYear",
        p."combinedCorporateRatio"::text AS "before",
        CASE
          WHEN (p."totalReceipts" + 0.5 * COALESCE(p."corporateIeSupportAmount", 0)) > 0
          THEN LEAST(1.0, (p."corporatePacAmount" + 0.5 * COALESCE(p."corporateIeSupportAmount", 0))
                       / NULLIF(p."totalReceipts" + 0.5 * COALESCE(p."corporateIeSupportAmount", 0), 0))::text
          ELSE NULL
        END AS "after"
      FROM "PacMoneyData" p
      JOIN "Legislator" l ON l.id = p."legislatorId"
      WHERE l."bioguideId" = ANY(${['W000790', 'F000479', 'M001243', 'H001089', 'S000033']})
        AND p."dataSource" = 'FEC_DIRECT'
      ORDER BY l."bioguideId", p."cycleYear"
    `;
    for (const s of sample) {
      const beforePct = s.before !== null ? `${(Number(s.before) * 100).toFixed(2)}%` : 'null';
      const afterPct = s.after !== null ? `${(Number(s.after) * 100).toFixed(2)}%` : 'null';
      console.log(`  ${s.bioguideId} cy=${s.cycleYear}  before=${beforePct} → after=${afterPct}`);
    }
    console.log('[recompute-pac-ratio-v191] dry run — no DB writes');
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.$executeRaw`
    UPDATE "PacMoneyData"
    SET
      "combinedCorporateRatio" = CASE
        WHEN ("totalReceipts" + 0.5 * COALESCE("corporateIeSupportAmount", 0)) > 0
        THEN LEAST(1.0, ("corporatePacAmount" + 0.5 * COALESCE("corporateIeSupportAmount", 0))
                     / NULLIF("totalReceipts" + 0.5 * COALESCE("corporateIeSupportAmount", 0), 0))
        ELSE NULL
      END,
      "updatedAt" = NOW()
    WHERE "dataSource" = 'FEC_DIRECT'
  `;
  console.log(`[recompute-pac-ratio-v191] updated ${result} row(s)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
