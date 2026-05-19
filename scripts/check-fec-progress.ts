// Quick progress check on the FEC ingest --force run. Shows how many
// PacMoneyData rows have been touched in the last 5 min and IE bucket
// coverage. No DB writes.
import prisma from '@/lib/prisma/prisma';
async function main() {
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const recent = await prisma.pacMoneyData.count({
    where: { dataSource: 'FEC_DIRECT', updatedAt: { gt: fiveMinAgo } },
  });
  const totalFec = await prisma.pacMoneyData.count({ where: { dataSource: 'FEC_DIRECT' } });
  const withIeData = await prisma.pacMoneyData.count({
    where: { dataSource: 'FEC_DIRECT', corporateIeSupportAmount: { gt: 0 } },
  });
  const withCombined = await prisma.pacMoneyData.count({
    where: { dataSource: 'FEC_DIRECT', combinedCorporateRatio: { not: null } },
  });
  console.log(`PacMoneyData FEC_DIRECT total: ${totalFec}`);
  console.log(`  updated in last 5 min:       ${recent}`);
  console.log(`  with corporateIeSupport>0:   ${withIeData}`);
  console.log(`  with combinedCorporateRatio: ${withCombined}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
