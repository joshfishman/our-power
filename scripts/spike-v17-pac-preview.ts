// v1.7.1 spike — preview the new PAC ratio for marquee legislators.
//
// For each leg: walk principal + JFC committees, sum contributions from PACs
// classified as CORPORATE / DARK_MONEY / FOREIGN_POLICY in our taxonomy
// table, divide by total principal receipts. Compare against the current
// FEC_DIRECT (broken) ratio.
//
// No DB writes. Goal: see whether the new methodology produces sensible
// numbers before committing to the full ingest.

import './load-env';
import fs from 'fs';
import path from 'path';

const KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const PAUSE_MS = 110;

// Multi-cycle aggregate: read all 4 cycles' transaction files. A leg's
// career corporate / dark-money / foreign-policy total is what differentiates
// safe-seat incumbents from active-race ones. Cycles included = 2018, 2020,
// 2022, 2024 = the 8-year window typical of campaign-finance scorecards.
const CYCLE_FILES = [
  { cycle: 2018, path: path.join(process.cwd(), 'data', 'fec-bulk-2018', 'itpas2.txt') },
  { cycle: 2020, path: path.join(process.cwd(), 'data', 'fec-bulk-2020', 'itpas2.txt') },
  { cycle: 2022, path: path.join(process.cwd(), 'data', 'fec-bulk-2022', 'itpas2.txt') },
  { cycle: 2024, path: path.join(process.cwd(), 'data', 'fec-bulk-2024', 'itpas2.txt') },
];
const PAC_CSV = path.join(process.cwd(), 'data', 'pac-candidates.csv');

interface Target {
  candId: string; // hard-coded FEC candidate_id (more reliable than name search)
  name: string;
  expected: string;
}

const TARGETS: Target[] = [
  { candId: 'H0LA01087', name: 'Scalise', expected: 'high corp (was 1.5%)' },
  { candId: 'H0CA48024', name: 'Issa', expected: 'mid corp (FEC bug)' },
  { candId: 'S4LA00065', name: 'Kennedy LA', expected: 'genuinely low PAC' },
  { candId: 'S4NJ00185', name: 'Booker', expected: 'AIPAC-heavy' },
  { candId: 'S4NJ00466', name: 'Kim NJ', expected: 'AIPAC-heavy' },
  { candId: 'S4MA00028', name: 'Markey', expected: 'mostly clean Dem' },
  { candId: 'S6NY00067', name: 'Schumer', expected: 'leadership-heavy' },
  { candId: 'S4VT00033', name: 'Sanders', expected: 'small-donor' },
  { candId: 'H2KY04121', name: 'Massie', expected: 'small-donor R' },
  { candId: 'H8NY15148', name: 'Ocasio-Cortez', expected: 'small-donor' },
  { candId: 'H8MN05239', name: 'Omar', expected: 'small-donor' },
  { candId: 'S8MO00226', name: 'Hawley', expected: 'mid corp R' },
  { candId: 'S4LA00099', name: 'Cassidy', expected: 'corp R' },
  { candId: 'H0CA51116', name: 'Vargas', expected: 'corp Dem' },
];

let lastCallAt = 0;
async function pace() {
  const e = Date.now() - lastCallAt;
  if (e < PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS - e));
  lastCallAt = Date.now();
}

// 1. Load classification table from data/pac-candidates.csv
interface PacClass {
  class: string;
  name: string;
}
function loadClassifications(): Map<string, PacClass> {
  const map = new Map<string, PacClass>();
  const lines = fs.readFileSync(PAC_CSV, 'utf-8').split('\n');
  // Header: committee_id,name,committee_type,org_type,connected_org,total_receipts,contribs_to_others,ind_exp,proposedClass,reason,finalClass
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"' && !inQ) inQ = true;
      else if (ch === '"' && inQ) inQ = false;
      else if (ch === ',' && !inQ) {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    if (cols.length < 11) continue;
    const proposed = cols[8];
    const final_ = cols[10];
    const cls = final_ || proposed;
    map.set(cols[0], { class: cls, name: cols[1] });
  }
  return map;
}

const COUNTS_AGAINST = new Set(['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY']);

interface CommitteeMeta {
  committee_id: string;
  designation: string;
  name: string;
}

// 3. List committees for a candidate (principal + JFC + leadership)
async function listCommittees(candId: string, cycle = 2024): Promise<CommitteeMeta[]> {
  await pace();
  const r = await fetch(`https://api.open.fec.gov/v1/committees/?api_key=${KEY}&candidate_id=${candId}&cycle=${cycle}`);
  if (!r.ok) return [];
  const j = (await r.json()) as {
    results: Array<{ committee_id: string; designation: string; name: string }>;
  };
  return (j.results ?? []).map((c) => ({
    committee_id: c.committee_id,
    designation: c.designation,
    name: c.name,
  }));
}

// 4. Get principal-committee total receipts
async function principalReceipts(committeeId: string, cycle = 2024): Promise<number> {
  await pace();
  const r = await fetch(`https://api.open.fec.gov/v1/committee/${committeeId}/totals/?api_key=${KEY}&cycle=${cycle}`);
  if (!r.ok) return 0;
  const j = (await r.json()) as { results: Array<Record<string, number>> };
  return Number(j.results?.[0]?.receipts ?? 0);
}

// 5. From itpas2.txt, find all PAC contributions TO each of the candidate's
//    committees. Apply classification. Sum counts-against.
// Parse the entire itpas2.txt ONCE and bucket by recipient committee.
// itpas2.txt is ~700K rows; reading 14× per leg burns minutes per run.
interface Transaction {
  donor: string;
  recipient: string; // committee_id for 24K/22Y; candidate_id for 24E/24A
  amount: number;
  kind: 'direct' | 'jfc-feed' | 'ie-support' | 'ie-oppose';
  cycle: number;
}
let _allTransactions: Transaction[] | null = null;
function loadAllTransactions(): Transaction[] {
  if (_allTransactions) return _allTransactions;
  const rows: Transaction[] = [];
  for (const { cycle, path: filePath } of CYCLE_FILES) {
    if (!fs.existsSync(filePath)) {
      console.warn(`  skipping cycle ${cycle} — file missing: ${filePath}`);
      continue;
    }
    let count = 0;
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 17) continue;
      const tx = cols[5];
      // Inclusion table:
      //   24K — direct PAC contribution to candidate principal committee
      //   22Y — PAC-to-PAC transfer (corp PAC feeding a JFC — captures the chain)
      //   24E — Super PAC IE supporting THIS candidate (counts toward candidate)
      //   24A — Super PAC IE opposing THIS candidate (info only)
      let kind: Transaction['kind'];
      if (tx === '24K') kind = 'direct';
      else if (tx === '22Y') kind = 'jfc-feed';
      else if (tx === '24E') kind = 'ie-support';
      else if (tx === '24A') kind = 'ie-oppose';
      else continue;
      const amt = Number(cols[14]) || 0;
      if (amt === 0) continue;
      const recipient = kind === 'ie-support' || kind === 'ie-oppose' ? cols[16] : cols[15];
      if (!recipient) continue;
      rows.push({ donor: cols[0], recipient, amount: amt, kind, cycle });
      count += 1;
    }
    console.log(`  loaded cycle ${cycle}: ${count.toLocaleString()} transactions`);
  }
  _allTransactions = rows;
  return rows;
}

interface InfluenceTotals {
  totalCountsAgainst: number;
  totalReceiptInfluence: number; // 24K direct + 22Y JFC-feed
  totalIESupport: number; // 24E IE supporting this candidate
  totalIEOppose: number; // 24A IE opposing this candidate (info only)
  byClass: Record<string, { direct: number; ieSupport: number; ieOppose: number; total: number }>;
}

function sumInfluenceForLeg(committeeIds: string[], candId: string, classMap: Map<string, PacClass>): InfluenceTotals {
  const cmteSet = new Set(committeeIds);
  const totals: InfluenceTotals = {
    totalCountsAgainst: 0,
    totalReceiptInfluence: 0,
    totalIESupport: 0,
    totalIEOppose: 0,
    byClass: {},
  };
  function bump(cls: string, kind: keyof InfluenceTotals['byClass'][string], amt: number) {
    if (!totals.byClass[cls]) totals.byClass[cls] = { direct: 0, ieSupport: 0, ieOppose: 0, total: 0 };
    totals.byClass[cls][kind] += amt;
    if (kind !== 'total') totals.byClass[cls].total += amt;
  }
  for (const t of loadAllTransactions()) {
    let kindLabel: 'direct' | 'ieSupport' | 'ieOppose' | null = null;
    if (t.kind === 'direct' || t.kind === 'jfc-feed') {
      if (!cmteSet.has(t.recipient)) continue;
      kindLabel = 'direct';
    } else if (t.kind === 'ie-support') {
      if (t.recipient !== candId) continue;
      kindLabel = 'ieSupport';
    } else if (t.kind === 'ie-oppose') {
      if (t.recipient !== candId) continue;
      kindLabel = 'ieOppose';
    }
    if (!kindLabel) continue;

    const cls = classMap.get(t.donor)?.class ?? 'UNCLASSIFIED';
    bump(cls, kindLabel, t.amount);

    if (kindLabel === 'direct') totals.totalReceiptInfluence += t.amount;
    else if (kindLabel === 'ieSupport') totals.totalIESupport += t.amount;
    else if (kindLabel === 'ieOppose') totals.totalIEOppose += t.amount;

    // Counts-against: corporate + dark_money + foreign_policy contributions
    // (direct OR IE supporting). IE-against doesn't count for the candidate.
    if ((cls === 'CORPORATE' || cls === 'DARK_MONEY' || cls === 'FOREIGN_POLICY') && kindLabel !== 'ieOppose') {
      totals.totalCountsAgainst += t.amount;
    }
  }
  return totals;
}

async function probeLeg(t: Target, classMap: Map<string, PacClass>) {
  console.log(`\n[${t.name}]  (${t.expected})`);
  const cmtes = await listCommittees(t.candId);
  if (cmtes.length === 0) {
    console.log(`  no committees`);
    return;
  }
  const principal = cmtes.find((c) => c.designation === 'P');
  if (!principal) {
    console.log(`  no principal committee`);
    return;
  }
  const principalCommitteeIds = cmtes.filter((c) => c.designation === 'P').map((c) => c.committee_id);
  const jfcCommitteeIds = cmtes.filter((c) => c.designation === 'J').map((c) => c.committee_id);
  const allCommitteeIds = [...principalCommitteeIds, ...jfcCommitteeIds];
  const receipts = await principalReceipts(principal.committee_id);

  const inf = sumInfluenceForLeg(allCommitteeIds, t.candId, classMap);

  // v1.7.1 PAC Score uses (counts-against influence dollars) /
  // (receipts + IE-support dollars). The denominator is "total influence
  // dollars touching this campaign" — raised receipts PLUS Super PAC IE
  // supporting them. This way a leg benefiting from $10M IE-support gets
  // properly attributed for that money, not just their own fundraising.
  const denom = receipts + inf.totalIESupport;
  const ratio = denom > 0 ? inf.totalCountsAgainst / denom : 0;
  const score = Math.max(0, Math.min(100, Math.round((1 - ratio) * 100)));

  console.log(`  cand=${t.candId}  principal=${principal.committee_id} (${principal.name})`);
  console.log(`  committees: ${principalCommitteeIds.length} principal, ${jfcCommitteeIds.length} JFC`);
  console.log(`  receipts (direct):       $${receipts.toLocaleString().padStart(14)}`);
  console.log(`  Super PAC IE support:    $${inf.totalIESupport.toLocaleString().padStart(14)}  (counted in denom)`);
  console.log(`  Super PAC IE oppose:     $${inf.totalIEOppose.toLocaleString().padStart(14)}  (info only)`);
  console.log(`  total influence (denom): $${denom.toLocaleString().padStart(14)}`);
  console.log(``);
  console.log(`  per-class breakdown (direct + IE support):`);
  const sorted = Object.entries(inf.byClass).sort((a, b) => b[1].total - a[1].total);
  for (const [cls, amts] of sorted) {
    const marker = COUNTS_AGAINST.has(cls) ? '⚠️' : '  ';
    const breakdown = `direct=$${amts.direct.toLocaleString()}  IE+=$${amts.ieSupport.toLocaleString()}  IE-=$${amts.ieOppose.toLocaleString()}`;
    console.log(`    ${marker} ${cls.padEnd(14)} $${amts.total.toLocaleString().padStart(12)}  (${breakdown})`);
  }
  console.log(``);
  console.log(
    `  ⚠️ COUNTS-AGAINST: $${inf.totalCountsAgainst.toLocaleString()} (${(ratio * 100).toFixed(1)}% of influence)`,
  );
  console.log(`  ➜ v1.7.1 PAC Score: ${score}%`);
}

async function main() {
  console.log(`[spike-v17-pac-preview] loading classification table…`);
  const classMap = loadClassifications();
  console.log(`  ${classMap.size} PACs in classification table`);
  const countsAgainstCount = [...classMap.values()].filter((v) => COUNTS_AGAINST.has(v.class)).length;
  console.log(`  ${countsAgainstCount} classified as counts-against`);

  for (const t of TARGETS) {
    await probeLeg(t, classMap);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
