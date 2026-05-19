// v1.6 calibration check: how does the alignment-percent score correlate
// with DW-NOMINATE dim1? If v1.6 is working, expect r ≈ -0.80 to -0.92
// (negative because positive Common Ground score = liberal-aligned,
// positive dim1 = conservative).
//
// Compare against v1.5: r was -0.488.

import prisma from '@/lib/prisma/prisma';
import fs from 'node:fs/promises';

const VOTEVIEW_CSV = '/tmp/voteview_members.csv';

interface DwRow {
  bioguideId: string;
  bioname: string;
  party: number;
  dim1: number;
  dim2: number;
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
  };
  const m = new Map<string, DwRow>();
  for (let l = 1; l < lines.length; l += 1) {
    const line = lines[l];
    if (!line) continue;
    const parts: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    if (parseInt(parts[i.congress], 10) !== 119) continue;
    const ch = parts[i.chamber];
    if (ch !== 'House' && ch !== 'Senate') continue;
    const bg = parts[i.bioguideId];
    if (!bg) continue;
    const d1 = parseFloat(parts[i.dim1]);
    if (!Number.isFinite(d1)) continue;
    m.set(bg, {
      bioguideId: bg,
      bioname: parts[i.bioname].replace(/^"|"$/g, ''),
      party: parseInt(parts[i.party], 10),
      dim1: d1,
      dim2: parseFloat(parts[i.dim2]),
    });
  }
  return m;
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
  console.log(`[calibrate-v16] loaded ${dw.size} 119th members from Voteview`);

  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', isActive: true, bioguideId: { not: null } },
    select: {
      bioguideId: true,
      fullName: true,
      party: true,
      scores: {
        where: { methodologyVersion: 'v1.6', publishedAt: { not: null } },
        select: { score: true },
      },
    },
  });

  const pairs: { name: string; party: string; avgPct: number; nPlanks: number; dw1: number }[] = [];
  for (const leg of legs) {
    if (!leg.bioguideId) continue;
    const d = dw.get(leg.bioguideId);
    if (!d) continue;
    if (leg.scores.length === 0) continue;
    // v1.6 stores 0-100 percent in `score` column. Average across planks.
    const avg = leg.scores.reduce((s, sc) => s + sc.score, 0) / leg.scores.length;
    pairs.push({ name: leg.fullName, party: leg.party, avgPct: avg, nPlanks: leg.scores.length, dw1: d.dim1 });
  }
  console.log(`[calibrate-v16] ${pairs.length} legislators matched`);

  const xs = pairs.map((p) => p.avgPct);
  const ys = pairs.map((p) => p.dw1);
  const r = pearson(xs, ys);
  console.log(`\n[calibrate-v16] Pearson r vs DW-NOMINATE dim1: ${r.toFixed(3)}`);
  console.log(`  v1.5 was -0.488; expect v1.6 around -0.80 to -0.92`);

  console.log(`\n[calibrate-v16] Average v1.6 percent by DW-NOMINATE decile:`);
  const sorted = [...pairs].sort((a, b) => a.dw1 - b.dw1);
  const ds = Math.ceil(sorted.length / 10);
  for (let d = 0; d < 10; d += 1) {
    const slice = sorted.slice(d * ds, (d + 1) * ds);
    if (slice.length === 0) break;
    const avgOur = slice.reduce((s, p) => s + p.avgPct, 0) / slice.length;
    const avgDw = slice.reduce((s, p) => s + p.dw1, 0) / slice.length;
    const bar = '█'.repeat(Math.min(80, Math.round(avgOur)));
    console.log(
      `  decile ${(d + 1).toString().padStart(2)} (dw≈${avgDw.toFixed(2).padStart(5)})  avg=${avgOur
        .toFixed(0)
        .padStart(3)}%  ${bar}`,
    );
  }

  console.log(`\n[calibrate-v16] Spot checks:`);
  const spotcheck = ['Ocasio-Cortez', 'Hawley', 'Pelosi', 'Greene', 'Sanders', 'Cruz', 'Norman', 'Vargas', 'Manchin'];
  for (const last of spotcheck) {
    const matches = pairs.filter((p) => p.name.includes(last));
    for (const m of matches.slice(0, 1)) {
      console.log(
        `  ${m.party} ${m.name.padEnd(35)} avg=${m.avgPct.toFixed(0).padStart(3)}%  dw1=${m.dw1
          .toFixed(2)
          .padStart(5)}  (${m.nPlanks} planks scored)`,
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
