// Verify Markey's PAC Score after reclassification.
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getLegislatorMoneyTrail } from '../src/lib/scorecard/queries';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const markey = await prisma.legislator.findFirst({
    where: { bioguideId: 'M000133' },
    select: { id: true, fullName: true },
  });
  if (!markey) {
    console.log('Markey not found');
    return;
  }
  const trail = await getLegislatorMoneyTrail(markey.id);
  console.log(`Markey (${markey.fullName}) PAC money trail:`);
  console.log(`  countsAgainst:   $${Math.round(trail.countsAgainst).toLocaleString()}`);
  console.log(`  totalReceipts:   $${Math.round(trail.totalReceipts).toLocaleString()}`);
  console.log(`  ieSupportTotal:  $${Math.round(trail.ieSupportTotal).toLocaleString()}`);
  console.log(`  denominator:     $${Math.round(trail.denominator).toLocaleString()}`);
  console.log(`  PAC Score:       ${trail.pacScore}`);
  console.log(`  byClass:`);
  for (const [c, v] of Object.entries(trail.byClass).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c.padEnd(16)} $${Math.round(v as number).toLocaleString()}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
