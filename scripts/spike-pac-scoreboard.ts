// v1.7.1 spike — per-PAC scoreboard preview.
//
// For each "headline" PAC (AIPAC, NRA, etc.) we aggregate the 2024-cycle
// PAC-to-candidate contributions from FEC bulk file itpas2.txt and join
// against our Legislator table, producing a list of "who got how much"
// for that PAC.
//
// This is the data backbone the per-issue / per-PAC scoreboard UI will
// render. Spike does not touch the DB; just prints top recipients to
// confirm shape + numbers before we build the ingest.
//
// itpas2.txt schema (pipe-delimited, no header):
//   0: CMTE_ID — donating PAC's committee_id
//   5: TRANSACTION_TP — 24K = contribution to candidate (filter)
//  14: TRANSACTION_AMT — dollars
//  16: CAND_ID — recipient candidate's FEC id (H0/S0 prefix)

import './load-env';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ITPAS2 = path.join(process.cwd(), 'data', 'fec-bulk-2024', 'itpas2.txt');
const HEADLINE_PACS: Array<{ committee_id: string; label: string }> = [
  { committee_id: 'C00797670', label: 'AIPAC' },
  { committee_id: 'C00053553', label: 'NRA Political Victory Fund' },
  { committee_id: 'C00441949', label: 'J Street PAC' },
  { committee_id: 'C00688655', label: 'Everytown Victory Fund' },
];

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const prisma = new PrismaClient({ adapter });

interface ContribAgg {
  candId: string;
  total: number;
  txCount: number;
}

async function aggregateForPac(pacId: string): Promise<Map<string, ContribAgg>> {
  const agg = new Map<string, ContribAgg>();
  const text = fs.readFileSync(ITPAS2, 'utf-8');
  for (const line of text.split('\n')) {
    if (!line || !line.startsWith(pacId + '|')) continue;
    const cols = line.split('|');
    if (cols.length < 17) continue;
    if (cols[5] !== '24K') continue; // contribution-to-candidate only
    const amt = Number(cols[14]) || 0;
    if (amt === 0) continue;
    const candId = cols[16];
    if (!candId) continue;
    const cur = agg.get(candId) ?? { candId, total: 0, txCount: 0 };
    cur.total += amt;
    cur.txCount += 1;
    agg.set(candId, cur);
  }
  return agg;
}

async function main(): Promise<void> {
  if (!fs.existsSync(ITPAS2)) {
    console.error(`itpas2.txt missing — download from FEC bulk`);
    process.exit(1);
  }
  // Lookup table — FEC candidate_id → our legislator
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, fullName: true, party: true, chamber: true, state: true, bioguideId: true },
  });
  // Map by bioguideId → leg metadata
  const legByBioguide = new Map(legs.map((l) => [l.bioguideId ?? '', l]));

  // FEC candidate_id is not the bioguide. We need a mapping. For the spike
  // we hit FEC's /candidates/?candidate_id=...&fields=bioguide_id endpoint
  // for the top recipients — too slow for thousands. Instead use the FEC
  // candidate master CSV. Quick alternative: build a candidate_id → name
  // lookup from itpas2.txt itself (col 7 is recipient name) and fuzzy-join.
  //
  // Cleanest: fetch FEC candidate master cn24.txt — has CAND_ID, NAME,
  // BIOGUIDE_ID columns. We've already downloaded cm24.zip; we need cn24.
  const cnPath = path.join(process.cwd(), 'data', 'fec-bulk-2024', 'cn24.txt');
  if (!fs.existsSync(cnPath)) {
    console.error(
      `cn24.txt missing — run: curl -sL https://www.fec.gov/files/bulk-downloads/2024/cn24.zip -o data/fec-bulk-2024/cn24.zip && unzip -o data/fec-bulk-2024/cn24.zip -d data/fec-bulk-2024`,
    );
    process.exit(1);
  }
  // cn24.txt: CAND_ID|CAND_NAME|CAND_PTY_AFFILIATION|...|CAND_ICI|...
  // No bioguide column. We'll match by name + state + office.
  interface CandRow {
    cand_id: string;
    name: string;
    office: string;
    state: string;
    party: string;
  }
  const candById = new Map<string, CandRow>();
  // cn24.txt schema (pipe-delimited, no header):
  //   0 CAND_ID  1 CAND_NAME  2 PARTY  3 ELECTION_YR  4 OFFICE_STATE
  //   5 OFFICE (H/S/P)  6 DISTRICT  7 ICI  8 STATUS  9 PCC
  for (const line of fs.readFileSync(cnPath, 'utf-8').split('\n')) {
    if (!line) continue;
    const cols = line.split('|');
    if (cols.length < 6) continue;
    candById.set(cols[0], {
      cand_id: cols[0],
      name: cols[1] ?? '',
      party: cols[2] ?? '',
      state: cols[4] ?? '',
      office: cols[5] ?? '',
    });
  }
  // Build a fuzzy index for our legs: "LAST, FIRST" + state → leg
  const legByKey = new Map<string, (typeof legs)[number]>();
  for (const l of legs) {
    const last = l.fullName.split(' ').pop()?.toUpperCase() ?? '';
    legByKey.set(`${last}|${l.state}|${l.chamber === 'SEN' ? 'S' : 'H'}`, l);
  }
  function resolveCandToLeg(candId: string): (typeof legs)[number] | null {
    const c = candById.get(candId);
    if (!c) return null;
    const last = c.name.split(',')[0]?.toUpperCase().trim() ?? '';
    return legByKey.get(`${last}|${c.state}|${c.office}`) ?? null;
  }

  for (const pac of HEADLINE_PACS) {
    console.log(`\n=== ${pac.label} (${pac.committee_id}) — top recipients in 2024 cycle ===`);
    const agg = await aggregateForPac(pac.committee_id);
    console.log(
      `  ${agg.size} candidate recipients · total $${[...agg.values()]
        .reduce((s, r) => s + r.total, 0)
        .toLocaleString()}`,
    );
    const sorted = [...agg.values()].sort((a, b) => b.total - a.total);
    let matched = 0;
    let unmatched = 0;
    let unmatchedDollars = 0;
    for (const r of sorted.slice(0, 30)) {
      const leg = resolveCandToLeg(r.candId);
      if (leg) {
        matched += 1;
        console.log(
          `  ${leg.party} ${leg.fullName.padEnd(28)} ${leg.chamber} ${leg.state}  $${r.total
            .toLocaleString()
            .padStart(10)}  (${r.txCount} txn)  cand=${r.candId}`,
        );
      } else {
        unmatched += 1;
        unmatchedDollars += r.total;
        const c = candById.get(r.candId);
        console.log(
          `  [no-match] ${(c?.name ?? '?').padEnd(36)} ${c?.state ?? ''}/${c?.office ?? ''}  $${r.total
            .toLocaleString()
            .padStart(10)}  cand=${r.candId}`,
        );
      }
    }
    console.log(
      `  (top 30: ${matched} matched, ${unmatched} unmatched — $${unmatchedDollars.toLocaleString()} unmatched)`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
