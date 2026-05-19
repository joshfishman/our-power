// Final v1.6 spot-check across federal + CA legislators
import prisma from '@/lib/prisma/prisma';

const TARGETS = [
  { last: 'Ocasio-Cortez', juris: 'FEDERAL' },
  { last: 'Hawley', juris: 'FEDERAL' },
  { last: 'Pelosi', juris: 'FEDERAL' },
  { last: 'Cruz', juris: 'FEDERAL' },
  { last: 'Norman', juris: 'FEDERAL' },
  { last: 'Vargas', juris: 'FEDERAL' },
  { last: 'Sanders', juris: 'FEDERAL' },
  // CA legislators
  { last: 'Kalra', juris: 'CA' },
  { last: 'Wiener', juris: 'CA' },
  { last: 'Newman', juris: 'CA' },
  { last: 'Gallagher', juris: 'CA' },
];

async function main(): Promise<void> {
  for (const t of TARGETS) {
    const legs = await prisma.legislator.findMany({
      where: { lastName: t.last, jurisdiction: t.juris as 'FEDERAL' | 'CA' },
      include: {
        scores: {
          where: { methodologyVersion: 'v1.6', publishedAt: { not: null } },
          include: { plank: { select: { number: true, name: true } } },
          orderBy: { plank: { number: 'asc' } },
        },
      },
    });
    if (legs.length === 0) {
      console.log(`✗ ${t.last} (${t.juris}) not found`);
      continue;
    }
    const leg = legs[0];
    if (leg.scores.length === 0) {
      console.log(`✗ ${leg.fullName} (${leg.jurisdiction}, ${leg.party}) — no v1.6 score`);
      continue;
    }
    const avg = leg.scores.reduce((s, sc) => s + sc.score, 0) / leg.scores.length;
    console.log(
      `${avg.toFixed(0).padStart(3)}%  ${leg.fullName.padEnd(35)} ${leg.jurisdiction.padEnd(8)} ${leg.party}  (${
        leg.scores.length
      } planks)`,
    );
    for (const sc of leg.scores) {
      console.log(`         P${sc.plank.number}: ${sc.score.toString().padStart(3)}%  · ${sc.plank.name}`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
