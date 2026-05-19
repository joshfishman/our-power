// Check what CA vote data we have via existing BillVote / MarkerBill ingest
import prisma from '@/lib/prisma/prisma';

async function main(): Promise<void> {
  const caLegs = await prisma.legislator.count({ where: { jurisdiction: 'CA', isActive: true } });
  const caMarkerBills = await prisma.markerBill.count({
    where: { marker: { plank: { jurisdiction: 'CA' } } },
  });
  const caBillVotes = await prisma.billVote.count({
    where: { bill: { marker: { plank: { jurisdiction: 'CA' } } } },
  });
  const caRollCalls = await prisma.rollCallVote.count({
    where: { chamber: { in: ['CA_ASSEMBLY', 'CA_SENATE'] } },
  });
  console.log('CA active legislators:', caLegs);
  console.log('CA MarkerBill rows:', caMarkerBills);
  console.log('CA BillVote rows (existing methodology):', caBillVotes);
  console.log('CA RollCallVote rows (v1.6 schema):', caRollCalls);

  // Sample of CA MarkerBills with vote data
  const ca = await prisma.markerBill.findMany({
    where: { marker: { plank: { jurisdiction: 'CA' } } },
    include: {
      _count: { select: { votes: true, sponsorships: true } },
      marker: { include: { plank: { select: { number: true } } } },
    },
    take: 20,
  });
  console.log('\nSample CA MarkerBills:');
  for (const b of ca) {
    console.log(
      `  P${b.marker.plank.number}  ${b.billNumber.padEnd(12)} votes=${b._count.votes}  spon=${
        b._count.sponsorships
      }  ${b.billTitle.slice(0, 60)}`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
