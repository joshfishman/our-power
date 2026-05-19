// Quick audit of RollCallVote + RollCallPosition data shape after ingest.
import prisma from '@/lib/prisma/prisma';

async function main(): Promise<void> {
  const totalVotes = await prisma.rollCallVote.count();
  const totalPos = await prisma.rollCallPosition.count();
  const byChamber = await prisma.rollCallVote.groupBy({ by: ['chamber'], _count: { _all: true } });
  const uniqueBills = await prisma.rollCallVote.groupBy({
    by: ['billType', 'billNumber'],
    where: { billNumber: { not: null } },
    _count: { _all: true },
  });
  const noBill = await prisma.rollCallVote.count({ where: { billNumber: null } });
  const passedFailed = await prisma.rollCallVote.groupBy({ by: ['voteResult'], _count: { _all: true } });
  console.log('RollCallVote rows:    ', totalVotes);
  console.log('RollCallPosition rows:', totalPos);
  console.log('--- by chamber ---');
  for (const r of byChamber) console.log('   ', r.chamber.padEnd(20), '=', r._count._all);
  console.log('--- unique bills referenced ---');
  console.log('   ', uniqueBills.length, 'unique (billType, billNumber) pairs');
  console.log('   ', noBill, 'votes without a bill linkage (procedural / election)');
  console.log('--- vote result breakdown ---');
  for (const r of [...passedFailed].sort((a, b) => b._count._all - a._count._all).slice(0, 8))
    console.log('   ', (r.voteResult || '(blank)').padEnd(25), '=', r._count._all);
  console.log('\n--- top 10 bill-types in votes ---');
  const typeGroup = await prisma.rollCallVote.groupBy({
    by: ['billType'],
    where: { billType: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  });
  for (const r of typeGroup) console.log('   ', (r.billType || '(none)').padEnd(12), '=', r._count._all);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
