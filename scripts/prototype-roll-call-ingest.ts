// Prototype for v1.6 "every roll-call by plank" methodology.
//
// What it does:
//   1. Pulls all House roll-call votes for 119th Congress via Congress.gov API.
//   2. For each vote: extract bill number + vote question + tally.
//   3. Apply a SIMPLE keyword classifier to estimate which plank each vote
//      *might* relate to. (Not the final AI classifier — just a quick
//      feasibility check on how many votes look plank-relevant.)
//   4. Report per-plank candidate-vote count and surface a sample of
//      classified votes for spot-checking.
//
// No DB writes. Just printout.
//
// Run: npx tsx --env-file=.env.local scripts/prototype-roll-call-ingest.ts

const API_KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const CONGRESS = 119;

interface HouseVote {
  rollCallNumber: number;
  sessionNumber: number;
  legislationNumber?: string;
  legislationType?: string;
  result: string;
  voteQuestion?: string;
  voteType: string;
  startDate: string;
  voteDesc?: string; // bill short name when present
}

async function fetchHouseVotes(session: number): Promise<HouseVote[]> {
  const out: HouseVote[] = [];
  let offset = 0;
  const LIMIT = 250;
  while (true) {
    const url = `https://api.congress.gov/v3/house-vote/${CONGRESS}/${session}?api_key=${API_KEY}&format=json&limit=${LIMIT}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`HTTP ${res.status} on ${url}`);
      break;
    }
    const json = (await res.json()) as { houseRollCallVotes?: HouseVote[]; pagination?: { count?: number } };
    const rows = json.houseRollCallVotes ?? [];
    out.push(...rows);
    if (rows.length < LIMIT) break;
    offset += LIMIT;
    await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

// Rough keyword-based plank classifier for the prototype. The production
// version would use an LLM to read the vote_question + bill_title + bill
// summary together. This is just to estimate feasibility.
function classifyPlank(text: string): string[] {
  const t = text.toLowerCase();
  const planks: string[] = [];
  // Plank 1 — Honest Government: ethics, lobbying, dark money, stock trading, voting rights
  if (
    /\b(ethics|lobbying|dark money|stock trading|disclose|voting rights|campaign finance|public financing|gerrymander|congressional disclosure)\b/.test(
      t,
    )
  )
    planks.push('P1');
  // Plank 2 — Children Our Future: education, climate, energy, science, infrastructure, environment, childcare
  if (
    /\b(education|school|teacher|child(?:hood| care)?|climate|carbon|emission|clean energy|solar|wind|nuclear|infrastructure|broadband|water|environment|epa|research|chips|stem)\b/.test(
      t,
    )
  )
    planks.push('P2');
  // Plank 3 — Making a Living: minimum wage, housing, predatory lending, worker protections, paid leave
  if (
    /\b(minimum wage|wage theft|housing|rental|tenant|loan rate|usury|family leave|paid leave|workforce|labor union|right to organize|non-compete|fair labor|overtime)\b/.test(
      t,
    )
  )
    planks.push('P3');
  // Plank 4 — The Care We Owe: medicare, medicaid, veterans, drug pricing, social security, childcare
  if (
    /\b(medicare|medicaid|veteran|drug pric|prescription|health (?:insurance|care)|social security|aca|affordable care|nursing|elder|disability)\b/.test(
      t,
    )
  )
    planks.push('P4');
  // Plank 5 — Peace & Strength: war powers, defense audit, antitrust, foreign policy, trade, state department
  if (
    /\b(war powers|aumf|pentagon|defense (?:budget|authorization|spending)|antitrust|monopoly|trade agreement|tariff|state department|diplomatic|foreign aid|nato|sanction|iran|china|russia)\b/.test(
      t,
    )
  )
    planks.push('P5');
  return planks;
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('No FEC_API_KEY / FEC_DATA_API in env');
    process.exit(1);
  }
  console.log(`[prototype] fetching all House roll-calls for 119th Congress...`);
  const s1 = await fetchHouseVotes(1);
  const s2 = await fetchHouseVotes(2);
  const all = [...s1, ...s2];
  console.log(`[prototype] fetched ${all.length} House votes (${s1.length} S1 + ${s2.length} S2)`);

  // Enrich each vote with bill description from Clerk.gov XML (in parallel
  // batches — the XML files are small and Clerk doesn't rate-limit aggressively).
  console.log(`[prototype] fetching Clerk.gov XML for ${all.length} votes (parallel batches of 20)...`);
  const enriched: HouseVote[] = [];
  const BATCH = 20;
  for (let i = 0; i < all.length; i += BATCH) {
    const slice = all.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (v) => {
        try {
          const year = v.startDate.slice(0, 4);
          const url = `https://clerk.house.gov/evs/${year}/roll${v.rollCallNumber.toString().padStart(3, '0')}.xml`;
          const res = await fetch(url);
          if (!res.ok) return v;
          const xml = await res.text();
          const descMatch = xml.match(/<vote-desc>([^<]+)<\/vote-desc>/);
          const questionMatch = xml.match(/<vote-question>([^<]+)<\/vote-question>/);
          return {
            ...v,
            voteDesc: descMatch?.[1]?.trim(),
            voteQuestion: questionMatch?.[1]?.trim() ?? v.voteQuestion,
          };
        } catch {
          return v;
        }
      }),
    );
    enriched.push(...results);
    if (i % 100 === 0) console.log(`  enriched ${i + slice.length}/${all.length}`);
  }

  // Classify each
  const buckets = new Map<string, HouseVote[]>();
  buckets.set('UNRELATED', []);
  for (const v of enriched) {
    const text = `${v.legislationType ?? ''} ${v.legislationNumber ?? ''} ${v.voteQuestion ?? ''} ${v.voteDesc ?? ''}`;
    const planks = classifyPlank(text);
    if (planks.length === 0) {
      buckets.get('UNRELATED')!.push(v);
      continue;
    }
    for (const p of planks) {
      if (!buckets.has(p)) buckets.set(p, []);
      buckets.get(p)!.push(v);
    }
  }
  console.log(`\n[prototype] keyword-classified bucket counts (one vote can hit multiple planks):`);
  for (const [k, arr] of [...buckets.entries()].sort()) {
    console.log(`    ${k}: ${arr.length} votes`);
  }
  console.log(`    [unique plank-relevant votes: ${all.length - buckets.get('UNRELATED')!.length}]`);

  // Spot-check: print 5 sample votes per plank
  for (const p of ['P1', 'P2', 'P3', 'P4', 'P5']) {
    const arr = buckets.get(p) ?? [];
    if (arr.length === 0) continue;
    console.log(`\n[prototype] sample ${p} votes (5 of ${arr.length}):`);
    for (const v of arr.slice(0, 5)) {
      const ln = v.legislationType && v.legislationNumber ? `${v.legislationType}.${v.legislationNumber}` : 'N/A';
      console.log(
        `    roll ${v.rollCallNumber}/S${v.sessionNumber} ${ln.padEnd(12)} ${v.result.padEnd(7)} ${
          v.voteQuestion?.slice(0, 70) ?? ''
        }`,
      );
    }
  }

  // Highlight UNRELATED that look like they SHOULD be plank-relevant (false negatives)
  console.log(
    `\n[prototype] sample UNRELATED votes (15 of ${
      buckets.get('UNRELATED')!.length
    }) — sanity-check the keyword filter:`,
  );
  for (const v of buckets.get('UNRELATED')!.slice(0, 15)) {
    const ln = v.legislationType && v.legislationNumber ? `${v.legislationType}.${v.legislationNumber}` : 'N/A';
    console.log(
      `    roll ${v.rollCallNumber}/S${v.sessionNumber} ${ln.padEnd(12)} ${v.voteQuestion?.slice(0, 70) ?? ''}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
