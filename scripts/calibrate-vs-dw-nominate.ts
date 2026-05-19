// Calibration check: how does our v1.5 score compare to DW-NOMINATE
// (Poole/Rosenthal), the academic standard for legislator ideology
// derived from ALL roll-call votes since 1789?
//
// Hypothesis: if our methodology is sound, the v1.5 score should
// correlate strongly with -dim1 (economic liberal/conservative,
// since our planks are mostly economic-progressive in direction).
// A correlation near 0 would suggest we're measuring noise rather
// than ideology; a correlation near -1 would suggest we're just
// re-deriving the standard ideology score (and adding no signal).
// Somewhere between -0.6 and -0.9 is the goldilocks zone — strongly
// related but with our methodology adding issue-specific structure.
//
// Source: https://voteview.com/static/data/out/members/HSall_members.csv
// Run: npx tsx --env-file=.env.local scripts/calibrate-vs-dw-nominate.ts

import prisma from '@/lib/prisma/prisma';
import fs from 'node:fs/promises';

const VOTEVIEW_CSV = '/tmp/voteview_members.csv';

interface DwRow {
  congress: number;
  chamber: 'House' | 'Senate';
  bioguideId: string;
  bioname: string;
  party: number; // 100=D, 200=R, 328=Indep
  dim1: number;
  dim2: number;
  numVotes: number;
}

async function loadDwNominate(): Promise<Map<string, DwRow>> {
  const text = await fs.readFile(VOTEVIEW_CSV, 'utf-8');
  const lines = text.split('\n');
  const header = lines[0].split(',');
  const idx = (col: string) => header.indexOf(col);
  const i = {
    congress: idx('congress'),
    chamber: idx('chamber'),
    bioguideId: idx('bioguide_id'),
    bioname: idx('bioname'),
    party: idx('party_code'),
    dim1: idx('nominate_dim1'),
    dim2: idx('nominate_dim2'),
    numVotes: idx('nominate_number_of_votes'),
  };
  const byBioguide = new Map<string, DwRow>();
  for (let l = 1; l < lines.length; l += 1) {
    const line = lines[l];
    if (!line) continue;
    // Simple CSV split — bionames have quoted commas, so respect quotes.
    const parts: string[] = [];
    let cur = '';
    let inQ = false;
    for (let c = 0; c < line.length; c += 1) {
      const ch = line[c];
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    const congress = parseInt(parts[i.congress], 10);
    const chamber = parts[i.chamber] as DwRow['chamber'];
    const bioguideId = parts[i.bioguideId];
    if (congress !== 119 || (chamber !== 'House' && chamber !== 'Senate') || !bioguideId) continue;
    const dim1 = parseFloat(parts[i.dim1]);
    if (!Number.isFinite(dim1)) continue;
    byBioguide.set(bioguideId, {
      congress,
      chamber,
      bioguideId,
      bioname: parts[i.bioname].replace(/^"|"$/g, ''),
      party: parseInt(parts[i.party], 10),
      dim1,
      dim2: parseFloat(parts[i.dim2]),
      numVotes: parseInt(parts[i.numVotes], 10),
    });
  }
  return byBioguide;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const ax = xs[i] - mx;
    const ay = ys[i] - my;
    num += ax * ay;
    dx += ax * ax;
    dy += ay * ay;
  }
  return num / Math.sqrt(dx * dy);
}

async function main(): Promise<void> {
  const dw = await loadDwNominate();
  console.log(`[calibrate] loaded ${dw.size} 119th-Congress members from Voteview`);

  // Pull our federal legislators + their v1.5 totals
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', isActive: true, bioguideId: { not: null } },
    select: {
      bioguideId: true,
      fullName: true,
      party: true,
      chamber: true,
      scores: {
        where: { methodologyVersion: 'v1.5', publishedAt: { not: null } },
        select: { score: true },
      },
    },
  });
  const calib = await prisma.scoreCalibration.findUnique({ where: { methodologyVersion: 'v1.5' } });
  const posA = Number(calib?.positiveAnchor ?? 17);
  const negA = Number(calib?.negativeAnchor ?? -4);

  const pairs: { name: string; party: string; ourPct: number; ourRaw: number; dw1: number; dw2: number }[] = [];
  for (const leg of legs) {
    if (!leg.bioguideId) continue;
    const d = dw.get(leg.bioguideId);
    if (!d) continue;
    if (leg.scores.length === 0) continue;
    const raw = leg.scores.reduce((s, ps) => s + ps.score, 0);
    // Match scoring.ts:rawToPercent piecewise — positive arm scales against
    // positiveAnchor, negative arm scales against |negativeAnchor|. raw is
    // already signed so we don't flip the sign on the negative arm.
    const pct = raw >= 0 ? (raw / posA) * 100 : (raw / Math.abs(negA)) * 100;
    pairs.push({ name: leg.fullName, party: leg.party, ourPct: pct, ourRaw: raw, dw1: d.dim1, dw2: d.dim2 });
  }
  console.log(`[calibrate] matched ${pairs.length} legislators (have both v1.5 score and DW-NOMINATE)`);

  const ourPcts = pairs.map((p) => p.ourPct);
  const dw1s = pairs.map((p) => p.dw1);
  const dw2s = pairs.map((p) => p.dw2);
  const r1 = pearson(ourPcts, dw1s);
  const r2 = pearson(ourPcts, dw2s);
  console.log(`\n[calibrate] Pearson correlation:`);
  console.log(`  our v1.5 percent  vs  DW-NOMINATE dim1 (econ): ${r1.toFixed(3)}`);
  console.log(`  our v1.5 percent  vs  DW-NOMINATE dim2 (social): ${r2.toFixed(3)}`);
  console.log(
    `  (expect dim1 ≈ -0.6 to -0.9 if methodology is working — negative because positive Common Ground score = liberal-aligned, and positive dim1 = conservative)`,
  );

  // Outlier detection: legislators where our score disagrees most with DW-NOMINATE
  console.log(
    `\n[calibrate] Top 10 'we say liberal-aligned, DW says very conservative' (potential false-positive credit):`,
  );
  pairs
    .filter((p) => p.ourPct > 0 && p.dw1 > 0.3)
    .sort((a, b) => b.ourPct - a.ourPct + (b.dw1 - a.dw1) * 50)
    .slice(0, 10)
    .forEach((p) =>
      console.log(`    ${p.party}  our=${p.ourPct.toFixed(0).padStart(4)}%  dw1=${p.dw1.toFixed(2)}  ${p.name}`),
    );
  console.log(`\n[calibrate] Top 10 'we say opposed, DW says very liberal' (potential false-negative):`);
  pairs
    .filter((p) => p.ourPct < 0 && p.dw1 < -0.3)
    .sort((a, b) => a.ourPct - b.ourPct + (a.dw1 - b.dw1) * 50)
    .slice(0, 10)
    .forEach((p) =>
      console.log(`    ${p.party}  our=${p.ourPct.toFixed(0).padStart(4)}%  dw1=${p.dw1.toFixed(2)}  ${p.name}`),
    );

  // Partisan-strength check: what is the average our-percent for each DW decile?
  console.log(`\n[calibrate] Average v1.5 percent by DW-NOMINATE decile (dim1 sorted liberal→conservative):`);
  const sorted = [...pairs].sort((a, b) => a.dw1 - b.dw1);
  const decileSize = Math.ceil(sorted.length / 10);
  for (let d = 0; d < 10; d += 1) {
    const slice = sorted.slice(d * decileSize, (d + 1) * decileSize);
    if (slice.length === 0) break;
    const avgOur = slice.reduce((s, p) => s + p.ourPct, 0) / slice.length;
    const avgDw = slice.reduce((s, p) => s + p.dw1, 0) / slice.length;
    const bar =
      avgOur > 0
        ? `▇`.repeat(Math.min(20, Math.round(avgOur / 5)))
        : '◁'.repeat(Math.min(20, Math.round(Math.abs(avgOur) / 5)));
    console.log(
      `    decile ${(d + 1).toString().padStart(2)} (dw≈${avgDw.toFixed(2).padStart(5)})  avg-our=${avgOur
        .toFixed(0)
        .padStart(4)}%  ${bar}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
