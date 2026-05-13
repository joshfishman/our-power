// scripts/find-historical-bills.ts
//
// Looks up LegiScan bill_ids for the three pre-119th historical bills
// (CHIPS, IIJA, PACT) by walking the proper LegiScan API chain:
//
//   1. getSessionList?state=US — list every US Congress session LegiScan tracks
//   2. Find the 117th Congress sessions (year_start = 2021)
//   3. getMasterListRaw?id={session_id} — full bill index for that session
//   4. Match by exact bill_number ("HB4346" / "SB3373" / "HB3684")
//
// getSearch was unreliable here because LegiScan's relevance ranking
// surfaces fuzzy matches (e.g. "No Chips for China" instead of "CHIPS
// and Science Act"). Walking the master list gives us a deterministic
// exact match.

import './load-env';
import { fetchWithTimeout } from '../src/lib/fetchWithTimeout';

const TARGETS: Array<{ label: string; numberNormalized: string }> = [
  // LegiScan strips dots/dashes — "H.R.4346" becomes "HB4346" in their normalized form.
  { label: 'CHIPS and Science Act (117th, H.R.4346)', numberNormalized: 'HB4346' },
  { label: 'Infrastructure Investment and Jobs Act (117th, H.R.3684)', numberNormalized: 'HB3684' },
  { label: 'Honoring our PACT Act (117th, S.3373)', numberNormalized: 'SB3373' },
];

interface Session {
  session_id: number;
  state_id: number;
  year_start: number;
  year_end: number;
  prefile: number;
  sine_die: number;
  prior: number;
  special: number;
  session_tag: string;
  session_title: string;
  session_name: string;
}

interface MasterBill {
  bill_id: number;
  number: string;
  number_string?: string;
  title: string;
  description?: string;
  status: number;
  last_action_date?: string;
  last_action?: string;
  url?: string;
}

async function call<T>(apiKey: string, op: string, params: Record<string, string | number>): Promise<T> {
  const usp = new URLSearchParams({ key: apiKey, op });
  for (const [k, v] of Object.entries(params)) usp.set(k, String(v));
  const url = `https://api.legiscan.com/?${usp.toString()}`;
  const r = await fetchWithTimeout(url, {}, 20_000);
  if (!r.ok) throw new Error(`LegiScan HTTP ${r.status} for op=${op}`);
  const json = (await r.json()) as { status: string } & Record<string, unknown>;
  if (json.status !== 'OK') throw new Error(`LegiScan non-OK for op=${op}: ${JSON.stringify(json).slice(0, 200)}`);
  return json as T;
}

function normalizeBillNumber(s: string | undefined): string {
  return (s ?? '').replace(/\s|-|\./g, '').toUpperCase();
}

async function main(): Promise<void> {
  const apiKey = process.env.LEGISCAN_API_KEY ?? '';
  if (!apiKey) {
    console.error('LEGISCAN_API_KEY missing in .env.local');
    process.exit(1);
  }

  console.log('Looking up 117th Congress sessions (year_start = 2021)...\n');
  const sessionsResp = await call<{ status: string; sessions: Session[] }>(apiKey, 'getSessionList', { state: 'US' });
  const candidates = sessionsResp.sessions.filter((s) => s.year_start === 2021);
  if (candidates.length === 0) {
    console.error('No 117th Congress (2021) sessions found in LegiScan US session list');
    process.exit(1);
  }
  console.log(`Found ${candidates.length} session(s):`);
  for (const s of candidates) {
    console.log(`  session_id=${s.session_id}  ${s.session_name} (${s.year_start}-${s.year_end})`);
  }

  // Walk every 117th session and accumulate every bill into a single index.
  console.log('\nFetching master bill list for each 117th session...');
  const billIndex = new Map<string, { bill_id: number; number: string; title: string; sessionId: number }>();
  for (const s of candidates) {
    process.stdout.write(`  session ${s.session_id}... `);
    const masterResp = await call<{ status: string; masterlist: Record<string, MasterBill | { session_id: number }> }>(
      apiKey,
      'getMasterListRaw',
      { id: s.session_id },
    );
    let count = 0;
    for (const [key, val] of Object.entries(masterResp.masterlist)) {
      if (key === 'session') continue;
      const bill = val as MasterBill;
      if (typeof bill.bill_id !== 'number') continue;
      const norm = normalizeBillNumber(bill.number);
      if (!norm) continue;
      // Don't overwrite — first session wins (which will be the regular
      // session in most cases). Defend against undefined title — some
      // master-list rows omit it (especially for resolutions / withdrawn).
      if (!billIndex.has(norm)) {
        billIndex.set(norm, {
          bill_id: bill.bill_id,
          number: bill.number ?? '',
          title: bill.title ?? '(no title in master list)',
          sessionId: s.session_id,
        });
      }
      count += 1;
    }
    console.log(`${count} bills indexed`);
  }
  console.log(`\nTotal indexed: ${billIndex.size} unique bill_numbers across 117th sessions.`);

  console.log('\n--- RESULTS ---');
  const found: Array<{ label: string; bill_id: number; number: string; title: string; sessionId: number }> = [];
  for (const t of TARGETS) {
    const hit = billIndex.get(t.numberNormalized);
    if (!hit) {
      console.log(`\n  ✗ ${t.label}\n      not found in any 117th session master list`);
      continue;
    }
    console.log(`\n  ✓ ${t.label}`);
    console.log(`      bill_id:    ${hit.bill_id}`);
    console.log(`      number:     ${hit.number}`);
    console.log(`      title:      ${(hit.title ?? '').slice(0, 80)}`);
    console.log(`      session_id: ${hit.sessionId}`);
    found.push({ label: t.label, ...hit });
  }

  if (found.length > 0) {
    console.log('\n--- PASTE-READY ---');
    for (const f of found) {
      console.log(`  ${f.label}\n    legiscanBillId: ${f.bill_id},`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
