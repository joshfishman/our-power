// Compare v1.6 natural-percentage scoring vs a curved version anchored on
// top-scorer = 100%, bottom-scorer = 0%.
import prisma from '@/lib/prisma/prisma';

async function main(): Promise<void> {
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', isActive: true },
    include: {
      scores: { where: { methodologyVersion: 'v1.6', publishedAt: { not: null } }, select: { score: true } },
    },
  });

  const rows = legs
    .filter((l) => l.scores.length > 0)
    .map((l) => ({
      name: l.fullName,
      party: l.party,
      chamber: l.chamber,
      natural: l.scores.reduce((s, sc) => s + sc.score, 0) / l.scores.length,
      nPlanks: l.scores.length,
    }))
    .sort((a, b) => b.natural - a.natural);

  const top = rows[0]!.natural;
  const bottom = rows[rows.length - 1]!.natural;

  console.log(`\n=== Natural vs Curved comparison (${rows.length} legislators) ===\n`);
  console.log(
    `Natural range: ${bottom.toFixed(1)}% (bottom) → ${top.toFixed(1)}% (top) — spread ${(top - bottom).toFixed(0)}pp`,
  );
  console.log(`Curve would map: ${bottom.toFixed(1)}% → 0%, ${top.toFixed(1)}% → 100% — spread 100pp\n`);

  console.log(`Sample legislators at three percentile slices:\n`);
  const sampleAt = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 1];
  console.log(`${'pct'.padStart(5)}  ${'name'.padEnd(35)}  ${'natural'.padStart(8)}  ${'curved'.padStart(7)}  diff`);
  for (const p of sampleAt) {
    const idx = Math.min(rows.length - 1, Math.max(0, Math.floor(p * (rows.length - 1))));
    const r = rows[idx];
    const curved = ((r.natural - bottom) / (top - bottom)) * 100;
    const diff = curved - r.natural;
    console.log(
      `${(p * 100).toFixed(0).padStart(4)}%  ${r.name.slice(0, 35).padEnd(35)}  ${r.natural
        .toFixed(1)
        .padStart(7)}%  ${curved.toFixed(1).padStart(6)}%  ${(diff >= 0 ? '+' : '') + diff.toFixed(1)}pp`,
    );
  }

  // Specific marquee names
  console.log(`\nMarquee names:\n`);
  for (const lookup of ['Hawley', 'Sanders', 'Ocasio-Cortez', 'Pelosi', 'Norman', 'Vargas', 'Cruz', 'AOC']) {
    const r = rows.find((x) => x.name.includes(lookup));
    if (!r) continue;
    const curved = ((r.natural - bottom) / (top - bottom)) * 100;
    const diff = curved - r.natural;
    console.log(
      `  ${r.party} ${r.name.padEnd(35)}  natural=${r.natural.toFixed(1).padStart(6)}%  curved=${curved
        .toFixed(1)
        .padStart(6)}%  Δ ${(diff >= 0 ? '+' : '') + diff.toFixed(1)}pp`,
    );
  }

  console.log(`\nDistribution buckets (natural):\n`);
  const bucketsNat = new Array(10).fill(0);
  for (const r of rows) {
    const b = Math.min(9, Math.floor(r.natural / 10));
    bucketsNat[b] += 1;
  }
  for (let i = 0; i < 10; i += 1) {
    console.log(
      `  ${(i * 10).toString().padStart(3)}-${(i * 10 + 10).toString().padStart(3)}%: ${'█'.repeat(
        Math.min(60, bucketsNat[i]),
      )} ${bucketsNat[i]}`,
    );
  }

  console.log(`\nDistribution buckets (curved):\n`);
  const bucketsCur = new Array(10).fill(0);
  for (const r of rows) {
    const curved = ((r.natural - bottom) / (top - bottom)) * 100;
    const b = Math.min(9, Math.floor(curved / 10));
    bucketsCur[b] += 1;
  }
  for (let i = 0; i < 10; i += 1) {
    console.log(
      `  ${(i * 10).toString().padStart(3)}-${(i * 10 + 10).toString().padStart(3)}%: ${'█'.repeat(
        Math.min(60, bucketsCur[i]),
      )} ${bucketsCur[i]}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
