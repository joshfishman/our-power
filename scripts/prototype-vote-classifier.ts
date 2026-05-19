// Step 2 of v1.6 prototype: pull bill titles + summaries for the 119th
// House votes, sample 30 of them, and show how an LLM-classifier would
// look. Demonstrates the data quality available for v1.6 redesign.
//
// Run: npx tsx --env-file=.env.local scripts/prototype-vote-classifier.ts

import './load-env';

const API_KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;

interface HouseVote {
  rollCallNumber: number;
  sessionNumber: number;
  legislationNumber?: string;
  legislationType?: string;
  result: string;
  voteQuestion?: string;
  voteType: string;
  startDate: string;
}

interface BillInfo {
  title: string;
  summary: string;
  policyArea: string;
  subjects: string[];
}

async function fetchHouseVotes(session: number): Promise<HouseVote[]> {
  const out: HouseVote[] = [];
  let offset = 0;
  const LIMIT = 250;
  while (true) {
    const url = `https://api.congress.gov/v3/house-vote/119/${session}?api_key=${API_KEY}&format=json&limit=${LIMIT}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const json = (await res.json()) as { houseRollCallVotes?: HouseVote[] };
    const rows = json.houseRollCallVotes ?? [];
    out.push(...rows);
    if (rows.length < LIMIT) break;
    offset += LIMIT;
    await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

async function fetchBillInfo(type: string, num: string): Promise<BillInfo | null> {
  const typeL = type.toLowerCase();
  // Fetch core bill
  const url = `https://api.congress.gov/v3/bill/119/${typeL}/${num}?api_key=${API_KEY}&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    bill?: { title?: string; policyArea?: { name?: string }; subjects?: { count?: number } };
  };
  const bill = json.bill;
  if (!bill) return null;
  // Subjects endpoint is separate
  const subjectsRes = await fetch(
    `https://api.congress.gov/v3/bill/119/${typeL}/${num}/subjects?api_key=${API_KEY}&format=json&limit=10`,
  );
  const subjectsJson = subjectsRes.ok
    ? ((await subjectsRes.json()) as { subjects?: { legislativeSubjects?: { name: string }[] } })
    : null;
  // Summaries endpoint
  const sumRes = await fetch(
    `https://api.congress.gov/v3/bill/119/${typeL}/${num}/summaries?api_key=${API_KEY}&format=json&limit=1`,
  );
  const sumJson = sumRes.ok ? ((await sumRes.json()) as { summaries?: { text?: string }[] }) : null;
  return {
    title: bill.title ?? '(no title)',
    summary: (sumJson?.summaries?.[0]?.text ?? '').replace(/<[^>]+>/g, '').slice(0, 300),
    policyArea: bill.policyArea?.name ?? '(no area)',
    subjects: subjectsJson?.subjects?.legislativeSubjects?.map((s) => s.name).slice(0, 5) ?? [],
  };
}

async function main(): Promise<void> {
  console.log('[prototype-classifier] fetching House votes...');
  const s1 = await fetchHouseVotes(1);
  const s2 = await fetchHouseVotes(2);
  const all = [...s1, ...s2];
  // Unique bills referenced
  const billKeys = new Set<string>();
  const billToVotes = new Map<string, HouseVote[]>();
  for (const v of all) {
    if (!v.legislationType || !v.legislationNumber) continue;
    const key = `${v.legislationType}/${v.legislationNumber}`;
    billKeys.add(key);
    if (!billToVotes.has(key)) billToVotes.set(key, []);
    billToVotes.get(key)!.push(v);
  }
  console.log(`[prototype-classifier] ${all.length} total votes across ${billKeys.size} unique bills/resolutions`);
  // Sample 30 random bills for inspection
  const sample = [...billKeys].sort(() => Math.random() - 0.5).slice(0, 30);
  console.log(`\n[prototype-classifier] fetching titles for ${sample.length} sample bills:\n`);
  for (const k of sample) {
    const [type, num] = k.split('/');
    const info = await fetchBillInfo(type, num);
    if (!info) {
      console.log(`  ${k.padEnd(15)} (no info available)`);
      continue;
    }
    const subj = info.subjects.length > 0 ? `[${info.subjects.slice(0, 3).join('; ')}]` : '';
    console.log(`  ${k.padEnd(15)} ${info.policyArea.padEnd(28)} ${info.title.slice(0, 70)} ${subj}`);
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`\n[prototype-classifier] bill-policy-area distribution across all 119th-Congress voted-on bills:\n`);
  const areaHist = new Map<string, number>();
  for (const k of [...billKeys].slice(0, 100)) {
    // Sample 100 to bound API time
    const [type, num] = k.split('/');
    const info = await fetchBillInfo(type, num);
    if (!info) continue;
    areaHist.set(info.policyArea, (areaHist.get(info.policyArea) ?? 0) + 1);
    await new Promise((r) => setTimeout(r, 30));
  }
  for (const [area, n] of [...areaHist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${area}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
