// TEMP exploration script — trace one legislator's scoring end to end.
// Read-only. Safe to delete.
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const leg = await prisma.legislator.findFirst({
    where: { fullName: { contains: 'Sanders', mode: 'insensitive' } },
    select: { id: true, fullName: true, jurisdiction: true, isActive: true },
  });
  if (!leg) {
    console.log('No legislator matching "Sanders" found.');
    return;
  }
  console.log('LEGISLATOR:', JSON.stringify(leg, null, 2));

  // Published score rows per plank
  const scores = await prisma.representativeScore.findMany({
    where: { legislatorId: leg.id },
    select: {
      score: true, forCount: true, againstCount: true, methodologyVersion: true,
      publishedAt: true, notes: true, plank: { select: { number: true, name: true } },
    },
    orderBy: { plank: { number: 'asc' } },
  });
  console.log('\nREPRESENTATIVE SCORES (per plank):');
  for (const s of scores) {
    console.log(
      `  P${s.plank.number} ${s.plank.name}: score=${s.score} for=${s.forCount} against=${s.againstCount} ` +
      `ver=${s.methodologyVersion} published=${s.publishedAt ? 'Y' : 'N'}`,
    );
  }
  const total = scores.filter((s) => s.publishedAt).reduce((a, s) => a + s.score, 0);
  console.log(`  -> raw total (published, summed): ${total}`);

  // Calibration anchors per methodology version
  const cals = await prisma.scoreCalibration.findMany({
    select: { methodologyVersion: true, positiveAnchor: true, negativeAnchor: true, computedFromCount: true },
  });
  console.log('\nSCORE CALIBRATION ANCHORS:');
  for (const c of cals) {
    console.log(`  ${c.methodologyVersion}: +100%=${c.positiveAnchor} raw, -100%=${c.negativeAnchor} raw (n=${c.computedFromCount})`);
  }

  // Plank 1 & 2 achievements with marker detail
  const achievements = await prisma.markerAchievement.findMany({
    where: { legislatorId: leg.id, marker: { plank: { number: { in: [1, 2] } } } },
    select: {
      actionTaken: true, achieved: true, evidenceType: true, sponsorTier: true, achievementScore: true,
      verifiedAt: true,
      marker: { select: { slug: true, name: true, markerType: true, plank: { select: { number: true } } } },
    },
    orderBy: { marker: { plank: { number: 'asc' } } },
  });
  console.log('\nPLANK 1 & 2 ACHIEVEMENTS:');
  for (const a of achievements) {
    console.log(
      `  P${a.marker.plank.number} [${a.marker.markerType}] ${a.marker.slug}: action=${a.actionTaken} ` +
      `evidence=${a.evidenceType} tier=${a.sponsorTier ?? '-'} achScore=${a.achievementScore ?? '-'} ` +
      `verified=${a.verifiedAt ? 'Y' : 'N'}`,
    );
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
