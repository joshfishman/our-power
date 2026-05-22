// One-shot diagnostic: what's in PacMoneyData for the marquee legislators?
// Run: npx tsx scripts/diag-pacmoneydata.ts

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const NAMES = ['Scalise', 'Issa', 'Massie', 'Kim', 'Markey', 'Booker', 'Sanders', 'Ocasio'];

async function main(): Promise<void> {
  for (const n of NAMES) {
    const leg = await prisma.legislator.findFirst({
      where: { lastName: { contains: n, mode: 'insensitive' }, isActive: true, jurisdiction: 'FEDERAL' },
      select: { id: true, fullName: true, state: true, party: true, fecIds: true },
    });
    if (!leg) continue;
    const rows = await prisma.pacMoneyData.findMany({
      where: { legislatorId: leg.id },
      select: { cycleYear: true, dataSource: true, totalReceipts: true, corporatePacAmount: true },
      orderBy: [{ dataSource: 'asc' }, { cycleYear: 'desc' }],
    });
    console.log(`\n${leg.fullName} (${leg.party}-${leg.state}) [fec=${leg.fecIds.join(',')}]`);
    for (const r of rows) {
      console.log(
        `  ${r.cycleYear} ${r.dataSource.padEnd(18)} receipts=$${Number(
          r.totalReceipts ?? 0,
        ).toLocaleString()}  corpPac=$${Number(r.corporatePacAmount ?? 0).toLocaleString()}`,
      );
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
