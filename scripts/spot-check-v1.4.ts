// One-off spot check: prints v1.4 percent + raw + plank breakdown for five
// representative legislators. No DB writes.
import prisma from '@/lib/prisma/prisma';
import { rawToPercent, PLANK_ENGINE_VERSION as METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';

const TARGETS = [
  { last: 'Brown', state: 'OH', chamber: 'SEN', party: 'D' },
  { last: 'Tester', state: 'MT', chamber: 'SEN', party: 'D' },
  { last: 'Ocasio-Cortez', state: 'NY', chamber: 'REP', party: 'D' },
  { last: 'Kennedy', state: 'LA', chamber: 'SEN', party: 'R' },
  { last: 'Kalra', state: 'CA', chamber: 'REP', party: 'D' },
];

async function main() {
  const calib = await prisma.scoreCalibration.findUnique({
    where: { methodologyVersion: METHODOLOGY_VERSION },
    select: { positiveAnchor: true, negativeAnchor: true },
  });
  if (!calib) {
    console.log('No ScoreCalibration row for', METHODOLOGY_VERSION);
    return;
  }
  const pos = Number(calib.positiveAnchor);
  const neg = Number(calib.negativeAnchor);
  console.log(`anchors: +100% = ${pos} raw, -100% = ${neg} raw\n`);

  for (const t of TARGETS) {
    const leg = await prisma.legislator.findFirst({
      where: { lastName: t.last, state: t.state, chamber: t.chamber as 'SEN' | 'REP' },
      include: {
        scores: {
          where: { methodologyVersion: METHODOLOGY_VERSION, publishedAt: { not: null } },
          include: { plank: { select: { number: true, name: true } } },
          orderBy: { plank: { number: 'asc' } },
        },
        pacData: { orderBy: { cycleYear: 'desc' }, take: 1 },
      },
    });
    if (!leg) {
      console.log(`✗ ${t.last} (${t.state}-${t.chamber}) not found`);
      continue;
    }
    const total = leg.scores.reduce((s, ps) => s + ps.score, 0);
    const pct = Math.round(rawToPercent(total, pos, neg));
    const pacPct = leg.pacData[0]?.corporatePacPercentage
      ? `${(Number(leg.pacData[0].corporatePacPercentage) * 100).toFixed(1)}%`
      : '—';
    const combo = leg.pacData[0]?.combinedCorporateRatio
      ? `${(Number(leg.pacData[0].combinedCorporateRatio) * 100).toFixed(1)}%`
      : '—';
    console.log(
      `${pct >= 0 ? '+' : ''}${pct}%   raw ${total >= 0 ? '+' : ''}${total}   ${leg.fullName} (${t.state}-${
        t.chamber
      }, ${t.party})   corp-PAC ${pacPct}  combined ${combo}`,
    );
    for (const ps of leg.scores) {
      console.log(`         Plank ${ps.plank.number}: ${ps.score >= 0 ? '+' : ''}${ps.score}  · ${ps.plank.name}`);
    }
    console.log();
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
