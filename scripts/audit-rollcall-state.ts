import prisma from '@/lib/prisma/prisma';

async function main(): Promise<void> {
  const byCls = await prisma.rollCallVote.groupBy({
    by: ['classifiedBy'],
    _count: { _all: true },
  });
  console.log('By classifiedBy:');
  for (const r of byCls) console.log(`  ${r.classifiedBy ?? '(null)'}: ${r._count._all}`);
  const scorable = await prisma.rollCallVote.count({ where: { isScorable: true } });
  const total = await prisma.rollCallVote.count();
  console.log(`isScorable=true: ${scorable} / ${total}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
