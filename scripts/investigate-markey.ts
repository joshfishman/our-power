// Investigate Markey's DARK_MONEY donors
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const markey = await prisma.legislator.findFirst({
    where: { bioguideId: 'M000133' },
    select: { id: true, bioguideId: true, fullName: true },
  });
  if (!markey) {
    console.log('Markey not found');
    return;
  }
  console.log('Markey:', markey);

  // Top DARK_MONEY donors by total contribution amount
  const rows = await prisma.$queryRaw<
    Array<{
      committeeId: string;
      name: string;
      connectedOrg: string | null;
      reason: string | null;
      source: string;
      class: string;
      finalClass: string | null;
      total: string;
      kinds: string;
    }>
  >`
    SELECT
      pc."committeeId",
      pc.name,
      pc."connectedOrg",
      pc.reason,
      pc.source,
      pc.class::text AS class,
      pc."finalClass",
      SUM(k.amount)::text AS total,
      string_agg(DISTINCT k.kind::text, ',') AS kinds
    FROM "PacContribution" k
    JOIN "PacClassification" pc ON pc."committeeId" = k."donorCommitteeId"
    WHERE k."legislatorId" = ${markey.id}
      AND pc.class = 'DARK_MONEY'
    GROUP BY pc."committeeId", pc.name, pc."connectedOrg", pc.reason, pc.source, pc.class, pc."finalClass"
    ORDER BY SUM(k.amount) DESC
    LIMIT 20
  `;

  console.log(`\nTop ${rows.length} DARK_MONEY donors to Markey:`);
  for (const r of rows) {
    console.log(`\n[$${Number(r.total).toLocaleString()}] ${r.committeeId} :: ${r.name}`);
    console.log(`  connectedOrg: ${r.connectedOrg ?? '(none)'}`);
    console.log(`  reason: ${r.reason ?? '(none)'} | source: ${r.source} | finalClass: ${r.finalClass ?? '-'}`);
    console.log(`  kinds: ${r.kinds}`);
  }

  // Total DARK_MONEY against Markey
  const total = await prisma.$queryRaw<Array<{ total: string }>>`
    SELECT COALESCE(SUM(k.amount), 0)::text AS total
    FROM "PacContribution" k
    JOIN "PacClassification" pc ON pc."committeeId" = k."donorCommitteeId"
    WHERE k."legislatorId" = ${markey.id} AND pc.class = 'DARK_MONEY'
  `;
  console.log(`\nTotal DARK_MONEY: $${Math.round(Number(total[0].total)).toLocaleString()}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
