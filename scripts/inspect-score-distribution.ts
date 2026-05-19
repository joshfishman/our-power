// One-off: print the distribution of v1.4 total scores so we can decide on
// the right anchor strategy. No DB writes.
import prisma from '@/lib/prisma/prisma';

async function main() {
  const rows = await prisma.representativeScore.findMany({
    where: { methodologyVersion: 'v1.4', publishedAt: { not: null } },
    select: { legislatorId: true, score: true },
  });
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.legislatorId, (totals.get(r.legislatorId) ?? 0) + r.score);
  const sorted = [...totals.values()].sort((a, b) => b - a);
  console.log(`legislators with v1.4 scores: ${sorted.length}`);
  console.log('top 15:', sorted.slice(0, 15).join(' '));
  console.log('bot 15:', sorted.slice(-15).join(' '));

  const buckets = new Map<number, number>();
  for (const t of sorted) buckets.set(t, (buckets.get(t) ?? 0) + 1);
  console.log('\nhistogram (raw → count):');
  for (const [raw, count] of [...buckets.entries()].sort((a, b) => b[0] - a[0])) {
    console.log(`  ${raw >= 0 ? '+' : ''}${raw}: ${'█'.repeat(Math.min(count, 60))} ${count}`);
  }

  function pct(p: number): number {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(((100 - p) / 100) * sorted.length)));
    return sorted[idx];
  }
  console.log('\npercentile anchors:');
  for (const p of [99, 98, 95, 90, 50, 10, 5, 2, 1]) {
    console.log(`  ${p}th: ${pct(p)}`);
  }
  console.log(`  min: ${sorted[sorted.length - 1]}   max: ${sorted[0]}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
