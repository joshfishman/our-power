// What federal bills actually have meaningful records, by party breakdown.
// Bills live in MarkerBill (no separate Bill model). Votes via BillVote.
// Sponsorships via BillSponsorship.

import prisma from '@/lib/prisma/prisma';

async function main(): Promise<void> {
  console.log('\n=== Federal MarkerBills — coverage breakdown (votes + sponsorships) ===\n');

  // Pull federal MarkerBills with their parent marker + plank
  const bills = await prisma.markerBill.findMany({
    where: { marker: { plank: { jurisdiction: 'FEDERAL' } } },
    include: {
      marker: { include: { plank: { select: { number: true, name: true } } } },
      _count: { select: { votes: true, sponsorships: true } },
    },
    orderBy: [{ marker: { plank: { number: 'asc' } } }, { billNumber: 'asc' }],
  });

  console.log(`  ${bills.length} federal MarkerBills total\n`);

  // For each bill, party-breakdown the votes
  for (const bill of bills) {
    const votes = await prisma.billVote.findMany({
      where: { billId: bill.id, position: { in: ['YES', 'NO', 'NOT_VOTING', 'EXCUSED', 'PRESENT'] } },
      include: { legislator: { select: { party: true } } },
    });
    const sponsorships = await prisma.billSponsorship.findMany({
      where: { billId: bill.id },
      include: { legislator: { select: { party: true } } },
    });
    const totalSignal = votes.length + sponsorships.length;
    if (totalSignal === 0) continue;
    const yesD = votes.filter((v) => v.position === 'YES' && v.legislator.party === 'D').length;
    const yesR = votes.filter((v) => v.position === 'YES' && v.legislator.party === 'R').length;
    const noD = votes.filter((v) => v.position === 'NO' && v.legislator.party === 'D').length;
    const noR = votes.filter((v) => v.position === 'NO' && v.legislator.party === 'R').length;
    const sponD = sponsorships.filter((s) => s.legislator.party === 'D').length;
    const sponR = sponsorships.filter((s) => s.legislator.party === 'R').length;
    const isDivisive = noD + noR >= 10 && yesD + yesR >= 10;
    const isCrossPartisan = (sponD >= 5 && sponR >= 5) || (yesD >= 10 && yesR >= 10);
    const tag = isDivisive ? '⭐ DIVISIVE' : isCrossPartisan ? '🤝 CROSS-PARTISAN' : '';
    console.log(
      `P${bill.marker.plank.number} ${bill.billNumber.padEnd(15)} signal=${totalSignal
        .toString()
        .padStart(3)}  votes y(D${yesD}/R${yesR}) n(D${noD}/R${noR})  cosponsors(D${sponD}/R${sponR})  ${tag}`,
    );
    console.log(`        ${bill.billTitle.slice(0, 90)}`);
  }

  console.log('\n=== Plank-by-plank: # bills with substantial signal (≥30 records) ===\n');
  const planks = await prisma.plank.findMany({ where: { jurisdiction: 'FEDERAL' }, orderBy: { number: 'asc' } });
  for (const plank of planks) {
    const plankBills = await prisma.markerBill.findMany({
      where: { marker: { plankId: plank.id } },
      include: { _count: { select: { votes: true, sponsorships: true } } },
    });
    const meaningful = plankBills.filter((b) => b._count.votes + b._count.sponsorships >= 30);
    const sparse = plankBills.filter((b) => b._count.votes + b._count.sponsorships < 30);
    console.log(
      `  P${plank.number} ${plank.name}: ${plankBills.length} total · ${meaningful.length} ≥30 records · ${sparse.length} sparse`,
    );
  }

  console.log('\n=== Sum of records by data type ===\n');
  const totalVotes = await prisma.billVote.count({
    where: { bill: { marker: { plank: { jurisdiction: 'FEDERAL' } } } },
  });
  const totalSpon = await prisma.billSponsorship.count({
    where: { bill: { marker: { plank: { jurisdiction: 'FEDERAL' } } } },
  });
  console.log(`  ${totalVotes} BillVote records · ${totalSpon} BillSponsorship records on federal bills`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
