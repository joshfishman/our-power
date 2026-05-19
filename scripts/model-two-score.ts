// Model the proposed two-score methodology:
//   Score 1 = (1 − combined_corporate_ratio) × 100  (Corporate PAC Money)
//   Score 2 = aligned_votes / (aligned + misaligned) × 100  (Voting Record across all planks)
//
// No DB writes. Just prints what the scores would look like for marquee legislators
// and overall distribution.
import prisma from '@/lib/prisma/prisma';

const TARGETS = [
  'Ocasio-Cortez',
  'Hawley',
  'Pelosi',
  'Cruz',
  'Norman',
  'Vargas',
  'Sanders',
  'Schumer',
  'McConnell',
  'Tlaib',
  'Bowman',
  'Massie',
  'Khanna',
  'Manchin',
];
const CA_TARGETS = ['Kalra', 'Wiener', 'Gallagher', 'Bonta'];

async function score2ForLegislator(legId: string): Promise<{ aligned: number; total: number } | null> {
  // All plank-relevant scorable positions for this legislator
  const rows = await prisma.rollCallPosition.findMany({
    where: {
      legislatorId: legId,
      vote: { isScorable: true, alignedPosition: { not: null } },
    },
    select: { position: true, vote: { select: { alignedPosition: true } } },
  });
  if (rows.length === 0) return null;
  let aligned = 0;
  for (const r of rows) {
    if (r.position === r.vote.alignedPosition) aligned += 1;
  }
  return { aligned, total: rows.length };
}

async function pacScoreForLegislator(legId: string): Promise<number | null> {
  const pac = await prisma.pacMoneyData.findFirst({
    where: { legislatorId: legId },
    orderBy: [{ dataSource: 'asc' }, { cycleYear: 'desc' }],
    select: { combinedCorporateRatio: true, corporatePacPercentage: true },
  });
  if (!pac) return null;
  const ratio = Number(pac.combinedCorporateRatio ?? pac.corporatePacPercentage ?? 0);
  return Math.max(0, Math.min(100, (1 - ratio) * 100));
}

async function main(): Promise<void> {
  console.log('Marquee model — Score 1 (PAC) · Score 2 (Voting) · Avg\n');
  for (const last of [...TARGETS, ...CA_TARGETS]) {
    const legs = await prisma.legislator.findMany({ where: { lastName: last } });
    for (const leg of legs.slice(0, 1)) {
      const score1 = await pacScoreForLegislator(leg.id);
      const s2 = await score2ForLegislator(leg.id);
      const score2 = s2 ? Math.round((s2.aligned / s2.total) * 100) : null;
      const avg = score1 !== null && score2 !== null ? Math.round((score1 + score2) / 2) : score1 ?? score2;
      const s1Str = score1 !== null ? `${Math.round(score1)}%` : '  —';
      const s2Str = score2 !== null ? `${score2}% (${s2!.aligned}/${s2!.total})` : '   — no votes';
      console.log(
        `  ${leg.party} ${leg.fullName.padEnd(35)} ${leg.jurisdiction.padEnd(8)}  PAC=${s1Str.padStart(
          5,
        )}  Vote=${s2Str.padEnd(18)}  Avg=${avg ?? '—'}%`,
      );
    }
  }

  console.log('\n— Full distribution —\n');
  const all = await prisma.legislator.findMany({
    where: { isActive: true },
    select: { id: true, jurisdiction: true, party: true, fullName: true },
  });
  const rows: { score1: number; score2: number; party: string; juris: string; name: string }[] = [];
  for (const leg of all) {
    const score1 = await pacScoreForLegislator(leg.id);
    const s2 = await score2ForLegislator(leg.id);
    const score2 = s2 ? (s2.aligned / s2.total) * 100 : null;
    if (score1 !== null && score2 !== null) {
      rows.push({ score1, score2, party: leg.party, juris: leg.jurisdiction, name: leg.fullName });
    }
  }
  rows.sort((a, b) => b.score1 + b.score2 - (a.score1 + a.score2));

  console.log(`  ${rows.length} legislators scored with both signals (avg-sorted top→bottom)\n`);
  console.log('  TOP 10:');
  for (const r of rows.slice(0, 10)) {
    console.log(
      `    ${r.party} ${r.name.padEnd(35)} ${r.juris.padEnd(8)}  PAC=${Math.round(r.score1)
        .toString()
        .padStart(3)}%  Vote=${Math.round(r.score2).toString().padStart(3)}%  Avg=${Math.round(
        (r.score1 + r.score2) / 2,
      )}%`,
    );
  }
  console.log('\n  BOTTOM 10:');
  for (const r of rows.slice(-10).reverse()) {
    console.log(
      `    ${r.party} ${r.name.padEnd(35)} ${r.juris.padEnd(8)}  PAC=${Math.round(r.score1)
        .toString()
        .padStart(3)}%  Vote=${Math.round(r.score2).toString().padStart(3)}%  Avg=${Math.round(
        (r.score1 + r.score2) / 2,
      )}%`,
    );
  }

  // Buckets by avg
  console.log('\n  Distribution buckets (avg of two scores):');
  const buckets = new Array(10).fill(0);
  for (const r of rows) {
    const avg = (r.score1 + r.score2) / 2;
    const b = Math.min(9, Math.floor(avg / 10));
    buckets[b] += 1;
  }
  for (let i = 9; i >= 0; i -= 1) {
    console.log(
      `    ${(i * 10).toString().padStart(3)}-${(i * 10 + 10).toString().padStart(3)}%: ${'█'.repeat(
        Math.min(60, Math.round(buckets[i] / 3)),
      )} ${buckets[i]}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
