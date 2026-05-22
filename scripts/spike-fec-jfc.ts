// Spike — Plan B PAC data fix.
//
// For each test legislator: pull their FEC candidate_id, walk every linked
// committee (principal candidate + Joint Fundraising Committees + leadership
// PACs that filed under their candidate_id), pull each committee's receipts
// breakdown, and compute what the corporate-PAC ratio WOULD be once we trace
// the JFC pass-through chain.
//
// We show 4 numbers per leg:
//   - currentRatio:  what compute-scores-v1.7 reads today (broken for House
//                    leadership where most $$ flows in via JFC transfers).
//   - directPacShare: PAC contributions / principal receipts. Same definition
//                    as currentRatio — sanity check that we match.
//   - jfcTracedShare: (principal direct PACs + sum of all linked JFCs'
//                    PAC contributions) / principal receipts. The fix.
//   - allPacShare:   for context, what % of principal receipts is "non-party
//                    non-individual" (PACs + transfers + party). Upper bound.
//
// No DB writes. Goal: verify the JFC-traced share is meaningfully different
// from the current ratio for House leadership types, before committing to a
// full ingest rewrite.

import './load-env';

const KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const PAUSE_MS = 110; // stay well under 1000/hr

const TARGETS: Array<{ name: string; office: 'H' | 'S'; state?: string; chamber: string; expected: string }> = [
  { name: 'scalise', office: 'H', state: 'LA', chamber: 'REP', expected: 'high corporate (Maj Leader)' },
  { name: 'issa', office: 'H', state: 'CA', chamber: 'REP', expected: 'high corporate (Issa, San Diego)' },
  { name: 'kennedy', office: 'S', state: 'LA', chamber: 'SEN', expected: 'high corporate (Senate R)' },
  { name: 'massie', office: 'H', state: 'KY', chamber: 'REP', expected: 'low corporate (libertarian R)' },
  { name: 'sanders', office: 'S', state: 'VT', chamber: 'SEN', expected: 'low corporate (small donors)' },
  { name: 'booker', office: 'S', state: 'NJ', chamber: 'SEN', expected: 'low-mid corporate (D)' },
  { name: 'kim', office: 'S', state: 'NJ', chamber: 'SEN', expected: 'low corporate (Andy Kim)' },
  { name: 'ocasio', office: 'H', state: 'NY', chamber: 'REP', expected: 'low corporate (AOC, small donors)' },
  { name: 'omar', office: 'H', state: 'MN', chamber: 'REP', expected: 'low corporate (Ilhan)' },
];

let lastCallAt = 0;
async function pace(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS - elapsed));
  lastCallAt = Date.now();
}

interface CommitteeRef {
  committee_id: string;
  committee_type: string | null;
  committee_type_full: string | null;
  designation: string | null;
  designation_full: string | null;
  name: string;
}

interface Totals {
  receipts: number;
  other_political_committee_contributions: number;
  political_party_committee_contributions: number;
  individual_contributions: number;
  transfers_from_other_authorized_committee: number;
  loans: number;
}

async function findCandidateId(
  name: string,
  office: 'H' | 'S',
  state?: string,
): Promise<{ id: string; fullName: string } | null> {
  await pace();
  const url = `https://api.open.fec.gov/v1/candidates/search/?api_key=${KEY}&name=${name}&office=${office}${
    state ? `&state=${state}` : ''
  }`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = (await r.json()) as { results: Array<{ candidate_id: string; name: string; active_through?: number }> };
  // Pick the most recently active candidate matching the office prefix.
  const officePrefix = office === 'H' ? 'H' : 'S';
  const cand = j.results.find((c) => c.candidate_id?.startsWith(officePrefix));
  return cand ? { id: cand.candidate_id, fullName: cand.name } : null;
}

async function listLinkedCommittees(candidateId: string, cycle: number): Promise<CommitteeRef[]> {
  await pace();
  // /committees/?candidate_id= returns ALL committees that ever filed under this candidate,
  // including JFCs and leadership PACs.
  const url = `https://api.open.fec.gov/v1/committees/?api_key=${KEY}&candidate_id=${candidateId}&cycle=${cycle}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = (await r.json()) as { results: CommitteeRef[] };
  return j.results ?? [];
}

async function committeeTotals(committeeId: string, cycle: number): Promise<Totals | null> {
  await pace();
  const url = `https://api.open.fec.gov/v1/committee/${committeeId}/totals/?api_key=${KEY}&cycle=${cycle}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = (await r.json()) as { results: Array<Record<string, number>> };
  const t = j.results?.[0];
  if (!t) return null;
  return {
    receipts: Number(t.receipts ?? 0),
    other_political_committee_contributions: Number(t.other_political_committee_contributions ?? 0),
    political_party_committee_contributions: Number(t.political_party_committee_contributions ?? 0),
    individual_contributions: Number(t.individual_contributions ?? 0),
    transfers_from_other_authorized_committee: Number(t.transfers_from_other_authorized_committee ?? 0),
    loans: Number(t.loans ?? 0),
  };
}

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

async function probeLegislator(target: (typeof TARGETS)[number], cycle: number) {
  const cand = await findCandidateId(target.name, target.office, target.state);
  if (!cand) {
    console.log(`\n[${target.name.toUpperCase()}] — no FEC candidate found`);
    return;
  }
  const committees = await listLinkedCommittees(cand.id, cycle);
  // Classify by designation
  const principalCommittees = committees.filter((c) => c.designation === 'P'); // Principal candidate
  const jfcs = committees.filter((c) => c.designation === 'J'); // Joint fundraising
  const leadershipPACs = committees.filter((c) => c.designation === 'D'); // Lead. PAC
  const other = committees.filter((c) => !['P', 'J', 'D'].includes(c.designation ?? ''));

  console.log(`\n[${cand.fullName} (${target.chamber}, expected: ${target.expected})] ${cand.id} cycle=${cycle}`);
  console.log(
    `  committees: ${principalCommittees.length} principal · ${jfcs.length} JFC · ${leadershipPACs.length} leadership PAC · ${other.length} other`,
  );

  // Sum totals across all principal committees (some legs have multiple over years).
  let principalReceipts = 0;
  let principalDirectPAC = 0;
  let principalIndividual = 0;
  let principalTransfers = 0;
  for (const c of principalCommittees) {
    const t = await committeeTotals(c.committee_id, cycle);
    if (!t) continue;
    principalReceipts += t.receipts;
    principalDirectPAC += t.other_political_committee_contributions;
    principalIndividual += t.individual_contributions;
    principalTransfers += t.transfers_from_other_authorized_committee;
    console.log(
      `    principal ${c.committee_id} ${c.name.padEnd(40)} receipts=${fmt(t.receipts)} PAC=${fmt(
        t.other_political_committee_contributions,
      )} ind=${fmt(t.individual_contributions)} xfer=${fmt(t.transfers_from_other_authorized_committee)}`,
    );
  }

  // Sum PAC contributions across all JFCs the leg is linked to.
  let jfcPacTotal = 0;
  let jfcReceipts = 0;
  for (const c of jfcs) {
    const t = await committeeTotals(c.committee_id, cycle);
    if (!t) continue;
    jfcPacTotal += t.other_political_committee_contributions;
    jfcReceipts += t.receipts;
    console.log(
      `    JFC       ${c.committee_id} ${c.name.padEnd(40)} receipts=${fmt(t.receipts)} PAC=${fmt(
        t.other_political_committee_contributions,
      )} ind=${fmt(t.individual_contributions)}`,
    );
  }

  if (principalReceipts === 0) {
    console.log(`  (no principal-committee data for cycle ${cycle})`);
    return;
  }

  const currentRatio = principalDirectPAC / principalReceipts;
  // JFC-traced: principal direct PAC + all JFC PAC contributions, divided by
  // principal receipts. This assumes JFC money flows ≥ to the principal; in
  // practice some JFCs split between two candidates (e.g. Buchanan + Scalise
  // Fund splits 50/50). We don't apportion here — the spike's purpose is to
  // verify the JFC chain meaningfully shifts the ratio.
  const jfcTraced = (principalDirectPAC + jfcPacTotal) / principalReceipts;
  // Upper bound: anything that isn't individual or candidate self-funded.
  const nonIndividualShare = (principalReceipts - principalIndividual) / principalReceipts;

  console.log(
    `  → CURRENT  PAC ratio: ${(currentRatio * 100).toFixed(1)}%  (= ${fmt(principalDirectPAC)} / ${fmt(
      principalReceipts,
    )} principal direct)`,
  );
  console.log(
    `  → JFC-TRACED ratio:    ${(jfcTraced * 100).toFixed(1)}%  (= ${fmt(principalDirectPAC + jfcPacTotal)} / ${fmt(
      principalReceipts,
    )} principal + JFC PAC$)`,
  );
  console.log(
    `  → NON-INDIVIDUAL upper: ${(nonIndividualShare * 100).toFixed(1)}%  (= receipts minus individual contributions)`,
  );
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error('FEC_API_KEY missing');
    process.exit(1);
  }
  const cycle = 2026;
  console.log(`[spike-fec-jfc] probing ${TARGETS.length} legislators for cycle ${cycle}\n`);
  for (const t of TARGETS) {
    await probeLegislator(t, cycle);
  }
  console.log(
    '\n[spike-fec-jfc] done. If JFC-TRACED numbers diverge meaningfully from CURRENT for House leadership types (Scalise, Issa, Kennedy), Plan B is validated.',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
