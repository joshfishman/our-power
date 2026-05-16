// Diagnostic: for every legislator in our DB, fetch IE-by-committee from
// FEC for the cycle they were most recently in, aggregate by committeeId,
// and print the top spenders that AREN'T already classified in our
// CommitteeClassification table. The output is the list of super PACs we'd
// most benefit from manually classifying.
//
// Usage:
//   FEC_API_KEY=... npx tsx scripts/find-top-ie-committees.ts
//   (or read from .env.local via tsx --env-file)
//
// No DB writes; prints a CSV-formatted block of suggestions on stdout.

import prisma from '@/lib/prisma/prisma';

const API_KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const FEC_BASE = 'https://api.open.fec.gov/v1';
const PAUSE_MS = 110;
let lastCallAt = 0;
async function pace() {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS - elapsed));
  lastCallAt = Date.now();
}

interface IeAggRow {
  committee_id: string;
  committee_name: string;
  support_oppose_indicator: 'S' | 'O' | null;
  total: number;
}

async function fetchIeByCommittee(candidateId: string, cycle: number): Promise<IeAggRow[]> {
  await pace();
  const url = `${FEC_BASE}/schedules/schedule_e/by_candidate/?api_key=${API_KEY}&cycle=${cycle}&candidate_id=${candidateId}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 429) {
      console.warn(`  [warn] 429 on ${candidateId} ${cycle}, sleeping 60s`);
      await new Promise((r) => setTimeout(r, 60_000));
      return fetchIeByCommittee(candidateId, cycle);
    }
    return [];
  }
  const json = (await res.json()) as { results?: IeAggRow[] };
  return json.results ?? [];
}

async function main(): Promise<void> {
  // Pull federal legislators with FEC IDs + their last-cycle PacMoneyData
  const legislators = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', isActive: true, fecIds: { isEmpty: false } },
    select: { id: true, fullName: true, fecIds: true, pacData: { orderBy: { cycleYear: 'desc' }, take: 1 } },
  });
  console.log(`[find-top-ie] scanning ${legislators.length} federal legislators`);

  // Pull already-classified committee IDs to filter them out
  const classified = await prisma.committeeClassification.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { committeeId: true, category: true, committeeName: true },
  });
  const classifiedIds = new Map(classified.map((c) => [c.committeeId, c]));
  console.log(`[find-top-ie] already classified: ${classifiedIds.size}`);

  // Aggregate IE spending by committee_id across all candidates
  const agg = new Map<string, { name: string; total: number; legislators: Set<string> }>();
  let processed = 0;
  for (const leg of legislators) {
    const fecId = leg.fecIds[leg.fecIds.length - 1];
    const cycle = leg.pacData[0]?.cycleYear ?? 2024;
    const rows = await fetchIeByCommittee(fecId, cycle);
    for (const r of rows) {
      if (!r.committee_id) continue;
      if (classifiedIds.has(r.committee_id)) continue;
      const entry = agg.get(r.committee_id) ?? {
        name: r.committee_name ?? '',
        total: 0,
        legislators: new Set<string>(),
      };
      entry.total += r.total ?? 0;
      entry.legislators.add(leg.fullName);
      if (!entry.name) entry.name = r.committee_name ?? '';
      agg.set(r.committee_id, entry);
    }
    processed += 1;
    if (processed % 25 === 0) {
      console.log(
        `[find-top-ie] processed ${processed}/${legislators.length}, ${agg.size} unique unclassified committees so far`,
      );
    }
  }

  // Sort by total IE, take top 50
  const sorted = [...agg.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 50);
  console.log(
    `\n[find-top-ie] TOP 50 UNCLASSIFIED IE SPENDERS (CSV format ready for manual-super-pac-classifications.csv)\n`,
  );
  console.log('committeeId,committeeName,category,sponsorName,sourceNotes');
  for (const [cid, info] of sorted) {
    const cleanName = info.name.replace(/"/g, '').replace(/,/g, '');
    console.log(
      `${cid},${cleanName},UNCLASSIFIED,,Top unclassified IE — \$${Math.round(info.total).toLocaleString()} across ${
        info.legislators.size
      } legislator(s)`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
