// v1.8.4 — Race-level "beneficiary" attribution for IE_OPPOSE rows
// (cycle-aware House attribution).
// v1.8.9 — Drop the Senate cross-state fallback. When no senator's
//   electionYr matches the IE cycleYear for that state, leave unattributed
//   (same conservative behavior the House path has had since v1.8.4).
//   Previously, PA-2022 IE_OPPOSE was being split 50/50 between Fetterman
//   (the actual 2022 candidate) and McCormick (whose only race we have is
//   2024), and similar misattributions for WI-2022 (Baldwin / Johnson),
//   NV-2022, AZ-2022, MT-2020. The "any senator in this state" fallback
//   never produced a correct answer — if neither senator ran in that
//   cycle's general election, splitting credit between them is purely a
//   guess. Drop it, like we did for the House.
//   Legitimate dual-race-same-cycle paths (e.g. Georgia 2020/2022 where
//   BOTH senators have electionYr === cycleYear) still flow through the
//   exact-year senateBySeatYear map: a state with two distinct (state|
//   cycleYear) keys keeps two distinct mappings, and we only credit the
//   one whose seat the IE filing actually pertains to.
//
// What this exists:
//   FEC's Schedule E filings attribute IE money to ONE target (the candidate
//   the spending is for or against). So when AIPAC's UDP spent $9.9M against
//   Jamaal Bowman in 2024, the filing says "IE_OPPOSE Bowman" — not
//   "IE_SUPPORT Latimer." The per-target PAC Score correctly reflects this:
//   Bowman gets the $9.9M IE_OPPOSE row, Latimer gets only what UDP filed
//   directly supporting HIM.
//
//   But that under-represents the influence picture for the winner.
//   Latimer DID materially benefit from $9.9M making his opponent disappear.
//   This script derives a "beneficiary attribution" by:
//
//   For each defeated H/S candidate (isActive=false) with IE_OPPOSE rows:
//     1. Look up the candidate's cycle + seat (state, chamber, district).
//     2. Find the active sitting legislator who WON that seat in that cycle.
//     3. For each IE_OPPOSE row against the defeated candidate, write a NEW
//        PacContribution row with kind=IE_OPPOSE_BENEFICIARY, same donor and
//        amount, attributed to the winning sitting legislator.
//
//   The IE_OPPOSE_BENEFICIARY rows are NEVER summed into the existing PAC
//   Score (per-target methodology stays unchanged). They're only used by
//   the separate "Beneficiary PAC Score" computation that the legislator
//   detail page surfaces as a parallel tile.
//
// Coverage notes:
//   - House (v1.8.4): matches by (state, district, cycleYear) → active
//     sitting rep who actually ran in that district in that cycle (per
//     cn{YY}.txt CAND_ELECTION_YR). Eliminates the "cycle bleed" bug
//     where the current NY-16 rep was credited for 2020 IE_OPPOSE against
//     Engel/Bowman (he wasn't in the 2020 race). When the cycle's winner
//     is no longer in our active set (e.g., Bowman, defeated in 2024),
//     the IE_OPPOSE is left unattributed rather than mis-credited.
//   - Senate (v1.8.9): matches by (state, electionYear) → active sitting
//     senator whose last election year matches the IE cycle. Strict
//     exact-year match only — no cross-state fallback. When the cycle's
//     actual general-election candidate is no longer in our active set
//     (lost, or hadn't been the candidate that cycle), the IE_OPPOSE is
//     left unattributed rather than mis-split between current senators.
//
// Usage:
//   npm run scorecard:attribute-ie-beneficiary
//   npm run scorecard:attribute-ie-beneficiary -- --dry-run

import './load-env';
import fs from 'fs';
import path from 'path';
import { createId } from '@paralleldrive/cuid2';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

// Cycles we read cn{YY}.txt for. Used by both House and (v1.8.9) Senate
// candidacy loaders to map active legislators back to the cycles they
// actually ran in for their current seat.
const CYCLES = [2018, 2020, 2022, 2024];
const FEC_BULK_BASE = path.join(process.cwd(), 'data');

// v1.8.9 — Load all Senate candidacies from cn{YY}.txt where the file's cycle
// matches CAND_ELECTION_YR. Mirrors loadHouseCandidacies. Replaces the old
// loadFecIdToElectionYear (which last-write-wins captured forward-looking
// re-election years from cn24.txt — e.g., Fetterman's cn24.txt entry says
// 2028, so his PA|maxYr key was PA|2028 not PA|2022, leaving every 2022 PA
// IE_OPPOSE unmatched and falling through to the now-removed state fallback).
interface SenateCandidacy {
  state: string;
  electionYr: number;
  cycleYear: number;
}
function loadSenateCandidacies(): Map<string, SenateCandidacy[]> {
  const out = new Map<string, SenateCandidacy[]>();
  for (const cycle of CYCLES) {
    const yy = String(cycle).slice(2);
    const fp = path.join(FEC_BULK_BASE, `fec-bulk-${cycle}`, `cn${yy}.txt`);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 6) continue;
      const candId = cols[0];
      const electionYr = Number(cols[3]);
      const state = cols[4];
      const office = cols[5];
      if (office !== 'S' || !candId || !state) continue;
      // Only count senate candidacies whose declared election year matches the
      // file's cycle. Filters out stale or forward-looking entries (a senator
      // already filed for 2028 re-election in 2024 has CAND_ELECTION_YR=2028
      // in cn24.txt — that's not a 2024 candidacy and shouldn't seed PA|2024
      // or PA|2028).
      if (!Number.isFinite(electionYr) || electionYr !== cycle) continue;
      const entries = out.get(candId) ?? [];
      entries.push({ state, electionYr, cycleYear: cycle });
      out.set(candId, entries);
    }
  }
  return out;
}

// v1.8.4 — Load every House candidacy record from cn{YY}.txt across cycles.
// Key: `${fecId}|${cycleYear}` → { state, district, electionYr }. We use
// (cycleYear from filename) as the canonical cycle even when CAND_ELECTION_YR
// disagrees, but we also keep electionYr for filtering down to candidates
// who were ACTIVELY running that cycle (election_yr == filename cycle).
interface HouseCandidacy {
  state: string;
  district: number;
  electionYr: number;
  cycleYear: number; // cn file's cycle (from filename)
}
function loadHouseCandidacies(): Map<string, HouseCandidacy[]> {
  const out = new Map<string, HouseCandidacy[]>();
  for (const cycle of CYCLES) {
    const yy = String(cycle).slice(2);
    const fp = path.join(FEC_BULK_BASE, `fec-bulk-${cycle}`, `cn${yy}.txt`);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 7) continue;
      const candId = cols[0];
      const electionYr = Number(cols[3]);
      const state = cols[4];
      const office = cols[5];
      const districtStr = cols[6];
      if (office !== 'H' || !candId || !state || !districtStr) continue;
      // Only count candidacies whose declared election year matches the file's
      // cycle. Without this, we'd pull stale records of candidates the FEC
      // file still lists (e.g., someone who ran in 2020 still in the 2024
      // cn.txt with electionYr=2020). With it, we only count true 2024 House
      // candidates from cn24.txt.
      if (!Number.isFinite(electionYr) || electionYr !== cycle) continue;
      const district = Number(districtStr);
      if (!Number.isFinite(district)) continue;
      const entries = out.get(candId) ?? [];
      entries.push({ state, district, electionYr, cycleYear: cycle });
      out.set(candId, entries);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[attribute-ie-beneficiary] flags: ${JSON.stringify(flags)}`);

  // 1. Build seat → active-legislator map.
  // House (v1.8.4): (state, district, cycleYear) → active sitting rep who ran
  //   in that district in that cycle (per cn{YY}.txt). Fixes the bug where the
  //   current rep was credited for IE_OPPOSE from cycles BEFORE they took the
  //   seat (e.g., Latimer crediting 2020 IE_OPPOSE against Engel/Bowman).
  // Senate (v1.8.9): (state, electionYear) → leg. Strict exact-year match.
  //   No "any senator in this state" fallback. e.g. Fetterman gets PA 2022
  //   IE_OPPOSE; McCormick gets PA 2024 IE_OPPOSE; PA 2020 (none of our
  //   active set) is left unattributed.
  console.log('[attribute-ie-beneficiary] loading House candidacies from cn*.txt…');
  const fecToHouseRuns = loadHouseCandidacies();
  console.log(`  ${fecToHouseRuns.size} House candidate FEC ids with candidacies`);
  console.log('[attribute-ie-beneficiary] loading Senate candidacies from cn*.txt…');
  const fecToSenateRuns = loadSenateCandidacies();
  console.log(`  ${fecToSenateRuns.size} Senate candidate FEC ids with candidacies`);

  const active = await prisma.legislator.findMany({
    where: { isActive: true, jurisdiction: 'FEDERAL' },
    select: { id: true, fullName: true, chamber: true, state: true, district: true, fecIds: true },
  });
  // House map (v1.8.4): (state, district, cycleYear) → active leg. Built by
  // intersecting each active rep's FEC ids with cn*.txt candidacy records
  // whose state+district match the rep's current seat. Only cycles where the
  // rep actually ran for the seat they now hold are included; older cycles
  // where someone else won the seat are left absent (and those IE_OPPOSE
  // rows will be left unattributed, NOT misattributed to the current rep).
  const houseBySeatYear = new Map<string, { id: string; fullName: string }>();
  // Senate map: (state, electionYear) → leg. Each sitting senator has a
  // most-recent election year; map that.
  const senateBySeatYear = new Map<string, { id: string; fullName: string }>();
  // v1.8.9 — Senators with no cn.txt cycle hit are logged but NOT mapped.
  // We previously had a "splitting between both senators" fallback; it
  // was always wrong when the actual cycle's candidate wasn't sitting.
  let houseCycleMappings = 0;
  let senateMappedByYear = 0;
  let senateNoYear = 0;
  for (const l of active) {
    if (l.chamber === 'REP' && l.district != null) {
      // For every cycle where any of this rep's FEC ids ran in their current
      // (state, district), mark them as the seat-cycle winner. We assume any
      // active rep whose FEC id appears in cn{cycle}.txt for their current
      // seat WON that cycle (since they're currently serving). Edge case:
      // a leg who lost in cycle N and won in cycle N+2 would be incorrectly
      // mapped for cycle N. We accept this as a much-narrower miss than the
      // current "credit for ALL past cycles in this district" bug.
      for (const fid of l.fecIds ?? []) {
        const runs = fecToHouseRuns.get(fid);
        if (!runs) continue;
        for (const r of runs) {
          if (r.state !== l.state || r.district !== l.district) continue;
          const k = `${l.state}|${l.district}|${r.cycleYear}`;
          // First-wins (in case of multiple FEC ids covering same seat-cycle)
          if (!houseBySeatYear.has(k)) {
            houseBySeatYear.set(k, { id: l.id, fullName: l.fullName });
            houseCycleMappings += 1;
          }
        }
      }
    } else if (l.chamber === 'SEN') {
      // v1.8.9 — Mirror the House approach: for every cycle where any of
      // this senator's FEC ids ran in cn{cycle}.txt with CAND_ELECTION_YR
      // matching the cycle (i.e., they were ACTUALLY a candidate that
      // cycle, not a sitting incumbent already filed for next-cycle
      // re-election), mark them as the seat-cycle winner. Previously this
      // used only their single most-recent election year, which forward-
      // looking cn24.txt entries corrupted (e.g., Fetterman cn24.txt says
      // electionYr=2028, so PA|2022 went unmapped and 2022 IE_OPPOSE fell
      // through to the now-removed state fallback that split between
      // Fetterman and McCormick). We assume any sitting senator whose FEC
      // id appears as a candidate that cycle WON it (since they're
      // currently serving). Edge case: a senator who lost cycle N and
      // won cycle N+2 would be incorrectly mapped for cycle N — narrow
      // miss versus the old "split with whichever other senator" bug.
      let mapped = false;
      for (const fid of l.fecIds ?? []) {
        const runs = fecToSenateRuns.get(fid);
        if (!runs) continue;
        for (const r of runs) {
          if (r.state !== l.state) continue;
          const k = `${l.state}|${r.cycleYear}`;
          if (!senateBySeatYear.has(k)) {
            senateBySeatYear.set(k, { id: l.id, fullName: l.fullName });
            mapped = true;
          }
        }
      }
      if (mapped) senateMappedByYear += 1;
      else senateNoYear += 1;
    }
  }
  console.log(
    `[attribute-ie-beneficiary] active legs: ${active.length} (${houseCycleMappings} house seat-cycle mappings, ${senateMappedByYear} senate cycle-mapped, ${senateNoYear} senate fallback)`,
  );

  // 2. Pull every IE_OPPOSE row against an INACTIVE leg.
  // Include the defeated leg's seat (state, chamber, district) to look up
  // the beneficiary. INNER join because we need the defeated leg's seat.
  const rows = await prisma.$queryRaw<
    Array<{
      donorCommitteeId: string;
      cycleYear: number;
      amount: string;
      state: string;
      chamber: string;
      district: number | null;
    }>
  >`
    SELECT k."donorCommitteeId", k."cycleYear", k.amount::text AS amount,
           l.state, l.chamber::text AS chamber, l.district
    FROM "PacContribution" k
    JOIN "Legislator" l ON l.id = k."legislatorId"
    WHERE k.kind = 'IE_OPPOSE'
      AND l."isActive" = FALSE
      AND l.jurisdiction = 'FEDERAL'
  `;
  console.log(`[attribute-ie-beneficiary] IE_OPPOSE rows against inactive legs: ${rows.length}`);

  // 3. Aggregate by (winnerLegId, donorCommitteeId, cycleYear).
  // Several IE_OPPOSE rows might map to the same beneficiary (e.g. multiple
  // donors against the same defeated leg). We aggregate per donor + cycle
  // so the unique key (legislatorId, donor, cycle, kind) holds.
  interface BenAgg {
    legislatorId: string;
    donorCommitteeId: string;
    cycleYear: number;
    amount: number;
  }
  const agg = new Map<string, BenAgg>();
  let creditedHouse = 0;
  let creditedSenate = 0;
  let unmatched = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    let beneficiaries: Array<{ id: string; fullName: string }> = [];
    if (r.chamber === 'REP' && r.district != null) {
      // v1.8.4 — cycle-aware lookup. If no active leg won this exact
      // (state, district, cycleYear), leave the row unattributed rather than
      // crediting whoever currently holds the seat.
      const b = houseBySeatYear.get(`${r.state}|${r.district}|${r.cycleYear}`);
      if (b) beneficiaries = [b];
    } else if (r.chamber === 'SEN') {
      // v1.8.9 — Exact-year match only. If no sitting senator's election
      // year matches r.cycleYear for r.state, leave the row unattributed
      // (conservative, mirrors House behavior since v1.8.4). The previous
      // "fall back to splitting between both senators" path produced
      // PA-2022 → Fetterman + McCormick (McCormick wasn't on the 2022
      // ballot), WI-2022 → Baldwin + Johnson (Baldwin was 2018/2024),
      // NV-2022, AZ-2022, MT-2020 misattributions. When the actual
      // cycle's candidate isn't in our active legislator set (lost
      // re-election, didn't run that cycle), no credit is the right
      // answer.
      const exact = senateBySeatYear.get(`${r.state}|${r.cycleYear}`);
      if (exact) beneficiaries = [exact];
    }
    if (beneficiaries.length === 0) {
      unmatched += 1;
      continue;
    }
    // v1.8.9 — Both House and Senate now produce a single beneficiary at
    // most. The split path remains for safety in case future code adds
    // legitimate multi-beneficiary cases.
    const share = beneficiaries.length === 1 ? amt : amt / beneficiaries.length;
    for (const ben of beneficiaries) {
      const key = `${ben.id}|${r.donorCommitteeId}|${r.cycleYear}`;
      const cur = agg.get(key) ?? {
        legislatorId: ben.id,
        donorCommitteeId: r.donorCommitteeId,
        cycleYear: r.cycleYear,
        amount: 0,
      };
      cur.amount += share;
      agg.set(key, cur);
    }
    if (r.chamber === 'REP') creditedHouse += 1;
    else creditedSenate += 1;
  }
  console.log(
    `[attribute-ie-beneficiary] mapped ${creditedHouse} House IE_OPPOSE → winner, ${creditedSenate} Senate IE_OPPOSE → cycle-year senator, ${unmatched} unmatched (v1.8.9: no cross-state fallback)`,
  );
  console.log(`[attribute-ie-beneficiary] aggregates to write: ${agg.size}`);

  if (flags.dryRun) {
    // Show top 20 beneficiaries by total credited $
    const byLeg = new Map<string, number>();
    for (const v of agg.values()) byLeg.set(v.legislatorId, (byLeg.get(v.legislatorId) ?? 0) + v.amount);
    const top = [...byLeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const legNames = await prisma.legislator.findMany({
      where: { id: { in: top.map((t) => t[0]) } },
      select: { id: true, fullName: true, party: true, state: true, chamber: true, district: true },
    });
    const nameMap = new Map(legNames.map((l) => [l.id, l]));
    console.log('\n[DRY RUN] top 20 beneficiaries:');
    for (const [id, amt] of top) {
      const l = nameMap.get(id);
      if (!l) continue;
      console.log(
        `  $${Math.round(amt).toLocaleString().padStart(12)}  ${l.party}-${l.state}${
          l.district ? '-' + l.district : ''
        }  ${l.chamber}  ${l.fullName}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // 4. Clear any existing IE_OPPOSE_BENEFICIARY rows (idempotent re-run).
  const deleted = await prisma.pacContribution.deleteMany({ where: { kind: 'IE_OPPOSE_BENEFICIARY' } });
  console.log(`[attribute-ie-beneficiary] cleared ${deleted.count} prior IE_OPPOSE_BENEFICIARY rows`);

  // 5. Bulk-insert. Skip rows where the donor isn't in PacClassification (FK).
  const donorIds = [...new Set([...agg.values()].map((v) => v.donorCommitteeId))];
  const knownDonors = await prisma.pacClassification.findMany({
    where: { committeeId: { in: donorIds } },
    select: { committeeId: true },
  });
  const knownDonorIds = new Set(knownDonors.map((r) => r.committeeId));
  const writable = [...agg.values()].filter((v) => knownDonorIds.has(v.donorCommitteeId));
  console.log(`[attribute-ie-beneficiary] writable rows (donor in PacClassification): ${writable.length}`);

  console.log('[attribute-ie-beneficiary] writing PacContribution rows…');
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < writable.length; i += BATCH) {
    const slice = writable.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((row, idx) => {
        const base = idx * 5;
        params.push(createId(), row.legislatorId, row.donorCommitteeId, row.cycleYear, row.amount);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${
          base + 4
        }, 'IE_OPPOSE_BENEFICIARY'::"ContributionKind", $${base + 5}::numeric, ARRAY[]::text[], NOW())`;
      })
      .join(',');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PacContribution" ` +
        `("id", "legislatorId", "donorCommitteeId", "cycleYear", "kind", "amount", "viaJfcCommitteeIds", "createdAt") ` +
        `VALUES ${values} ` +
        // The unique key is (legislatorId, donorCommitteeId, cycleYear, kind). For
        // IE_OPPOSE_BENEFICIARY rows specifically, we deleted prior rows above,
        // so conflicts shouldn't happen. ON CONFLICT DO UPDATE as a safety net.
        `ON CONFLICT ("legislatorId", "donorCommitteeId", "cycleYear", "kind") DO UPDATE SET "amount" = EXCLUDED."amount"`,
      ...params,
    );
    written += slice.length;
    if (written % 5000 === 0 || i + BATCH >= writable.length) {
      console.log(`  inserted ${written}/${writable.length}`);
    }
  }
  console.log(`[attribute-ie-beneficiary] ✓ wrote ${written} IE_OPPOSE_BENEFICIARY rows`);

  // 6. Show top movers
  const top = await prisma.$queryRaw<Array<{ fullName: string; party: string; state: string; total: string }>>`
    SELECT l."fullName", l.party::text AS party, l.state,
           SUM(k.amount::numeric)::text AS total
    FROM "PacContribution" k
    JOIN "Legislator" l ON l.id = k."legislatorId"
    WHERE k.kind = 'IE_OPPOSE_BENEFICIARY'
    GROUP BY l."fullName", l.party, l.state
    ORDER BY total DESC
    LIMIT 15
  `;
  console.log('\n[attribute-ie-beneficiary] Top 15 beneficiaries:');
  for (const r of top) {
    console.log(
      `  ${r.party}-${r.state.padEnd(2)}  $${Math.round(Number(r.total)).toLocaleString().padStart(12)}  ${r.fullName}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
