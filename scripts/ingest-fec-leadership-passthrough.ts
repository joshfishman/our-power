// v1.9.0 — LEADERSHIP PAC pass-through attribution.
//
// Parallel to v1.8.6's JFC pass-through ingest. Where the JFC variant traces
//   corp PAC ──18K──▶ JFC ──24G/24K──▶ candidate principal committee
// this script traces
//   corp PAC ──18K──▶ LEADERSHIP PAC ──24G/24K──▶ candidate principal committee
//
// Why we need it. The legislator-controlled "leadership PAC" is a separate
// committee that raises money from outside donors (often corporate / industry
// PACs) and re-disburses it to colleagues — a routine vehicle for routing
// corporate dollars to members who otherwise refuse direct corporate PAC
// money. v1.7.2 added LEADERSHIP as a PacClassification class and surfaced
// inbound corp dollars TO each leg's own leadership PAC as an informational
// signal, but did NOT attribute the OUTBOUND apportionment to the recipient
// colleagues. Top GOP "high-PAC-score" senators (Scalise 99-100, Massie
// 84-92, Burchett 89-92) score clean because they avoid direct corp PAC
// inflows — but corp money still reaches them through colleague leadership
// PACs. This ingest closes that gap.
//
// Methodology decision (v1.9.0): LEADERSHIP_PASS_THROUGH dollars count
// against the recipient's PAC Score as the ORIGINAL CORP donor class
// (CORPORATE / DARK_MONEY / FOREIGN_POLICY). The leadership PAC is the
// conduit; the corp nature of the money is preserved. This mirrors the JFC
// pass-through treatment — the "counts-against" buckets in the PAC Score
// formula (queries.ts) include both kinds.
//
// Important nuance vs. the LEADERSHIP-direct treatment: direct DIRECT
// contributions FROM a leadership PAC to a candidate (which the existing FEC
// ingest already records) are currently labeled with the LEADERSHIP class,
// which is treated as non-counts-against (politician-controlled, not a
// foreign / corp / dark interest). That behavior is unchanged in v1.9.0.
// LEADERSHIP_PASS_THROUGH does NOT overlap or double-count with that: this
// script only attributes the CORP-originated fraction of each leadership
// PAC's inflows, allocated proportionally to its outflows.
//
// Approach (per cycle, per LEADERSHIP committee L):
//   1. INBOUND: sum 18K contributions into L from each donor PAC
//      (ENTITY_TP='PAC' or 'COM') where the donor is classified
//      CORPORATE / DARK_MONEY / FOREIGN_POLICY in PacClassification.
//   2. OUTBOUND: sum 24G+24K contributions from L to candidate principal
//      committees (and to party committees — included in the denominator so
//      the per-candidate share is correctly proportional).
//   3. APPORTION: for each (donor d, recipient candidate r),
//        attributed = inbound_from_d × (outbound_to_r / total_outbound).
//      Aggregate per (legislatorId, donorCommitteeId, cycleYear) across all
//      leadership PACs the donor went through. Track via leadership PAC
//      committee ids in viaJfcCommitteeIds (column reused — see schema note).
//
// Bug-fixes carried over from v1.8.6 (JFC variant):
//   1. PARTY-COMMITTEE OUTBOUND counted in the denominator so per-candidate
//      shares are correctly proportional (state party / Hill committee
//      outflows from a leadership PAC are common).
//   2. MEMO_CD ROWS skipped on both inbound 18K and outbound 24G/24K — they
//      re-state a parent transaction and double-count the dollar otherwise.
//   3. itoth MEMO_CD lives at col 18; itpas2 MEMO_CD at col 19 (itpas2 has
//      an extra CAND_ID column).
//
// FEC bulk file roles (identical to JFC ingest):
//   - cm.txt:     committee master. Used here for party-committee detection
//                  (CMTE_TP X/Y) and candidate principal mapping (CMTE_DSGN
//                  P + CAND_ID at col 14).
//   - itoth.txt:  18K inbound, 24G outbound.
//   - itpas2.txt: 24K outbound to candidates.
//
// Run:
//   npm run scorecard:ingest-fec-leadership-passthrough
//   npm run scorecard:ingest-fec-leadership-passthrough -- --dry-run
//   npm run scorecard:ingest-fec-leadership-passthrough -- --cycle=2024

import './load-env';
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Cycles parameterized. Defaults cover 2018→2026; missing directories are
// silently skipped by existsSync guards. Single cycle via `--cycle=2026`.
const CYCLE_DIRS = [
  { cycle: 2018, dir: path.join(process.cwd(), 'data', 'fec-bulk-2018') },
  { cycle: 2020, dir: path.join(process.cwd(), 'data', 'fec-bulk-2020') },
  { cycle: 2022, dir: path.join(process.cwd(), 'data', 'fec-bulk-2022') },
  { cycle: 2024, dir: path.join(process.cwd(), 'data', 'fec-bulk-2024') },
  { cycle: 2026, dir: path.join(process.cwd(), 'data', 'fec-bulk-2026') },
];

// PAC classes whose money "counts against" — must match queries.ts.
const COUNTS_AGAINST_CLASSES = new Set(['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY']);

interface CliFlags {
  dryRun: boolean;
  cycle: number | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, cycle: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--cycle=')) flags.cycle = Number(arg.split('=')[1]);
  }
  return flags;
}

async function loadCandToLegMap(): Promise<Map<string, string>> {
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, fecIds: true },
  });
  const map = new Map<string, string>();
  for (const l of legs) for (const fecId of l.fecIds) if (fecId) map.set(fecId, l.id);
  return map;
}

// cm.txt columns (pipe-delimited, by index):
//   0 CMTE_ID  1 CMTE_NM  2 TRES_NM  3 ADDR1  4 ADDR2  5 CITY  6 ST
//   7 ZIP  8 CMTE_DSGN  9 CMTE_TP  10 CMTE_PTY_AFFILIATION
//   11 CMTE_FILING_FREQ  12 ORG_TP  13 CONNECTED_ORG_NM  14 CAND_ID
function loadCommitteeMaps(): {
  cmteToCand: Map<string, string>;
  cmteName: Map<string, string>;
  partyIds: Set<string>;
} {
  const cmteToCand = new Map<string, string>();
  const cmteName = new Map<string, string>();
  const partyIds = new Set<string>([
    'C00000935', // DCCC
    'C00075820', // NRCC
    'C00042366', // DSCC
    'C00027466', // NRSC
    'C00010603', // DNC
    'C00003418', // RNC
  ]);
  for (const { dir } of CYCLE_DIRS) {
    const cmPath = path.join(dir, 'cm.txt');
    if (!fs.existsSync(cmPath)) continue;
    const text = fs.readFileSync(cmPath, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 15) continue;
      const cmteId = cols[0];
      const name = cols[1];
      const designation = cols[8];
      const cmteType = cols[9];
      const candId = cols[14];
      if (!cmteId) continue;
      if (name && !cmteName.has(cmteId)) cmteName.set(cmteId, name);
      if (designation === 'P' && candId) cmteToCand.set(cmteId, candId);
      if (cmteType === 'X' || cmteType === 'Y') partyIds.add(cmteId);
    }
  }
  return { cmteToCand, cmteName, partyIds };
}

interface LeaderAgg {
  inbound: Map<string, number>; // donor committee id → $ in (classified counts-against only)
  outbound: Map<string, number>; // recipient principal/party committee id → $ out
}

interface Attribution {
  legislatorId: string;
  donorCommitteeId: string;
  cycleYear: number;
  amount: number;
  viaLeadershipPacs: Set<string>;
}

async function streamLines(filepath: string, onLine: (cols: string[]) => void, label: string): Promise<number> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filepath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    const cols = line.split('|');
    onLine(cols);
    n += 1;
    if (n % 2_000_000 === 0) console.log(`    ${label}: ${n.toLocaleString()} rows scanned`);
  }
  return n;
}

async function processCycle(
  cycle: number,
  dir: string,
  leadershipIds: Set<string>,
  cmteToCand: Map<string, string>,
  candToLeg: Map<string, string>,
  classifiedDonors: Map<string, string>,
  attributions: Map<string, Attribution>,
  partyIds: Set<string>,
): Promise<{
  leadershipActive: number;
  rowsAttributed: number;
  dollarsAttributed: number;
  memoSkipped: number;
  partyOutboundDollars: number;
}> {
  const itpasPath = path.join(dir, 'itpas2.txt');
  const othPath = path.join(dir, 'itoth.txt');
  if (!fs.existsSync(itpasPath)) {
    console.warn(`  cycle ${cycle}: missing itpas2.txt — skipping`);
    return {
      leadershipActive: 0,
      rowsAttributed: 0,
      dollarsAttributed: 0,
      memoSkipped: 0,
      partyOutboundDollars: 0,
    };
  }
  if (!fs.existsSync(othPath)) {
    console.warn(`  cycle ${cycle}: missing itoth.txt — skipping`);
    return {
      leadershipActive: 0,
      rowsAttributed: 0,
      dollarsAttributed: 0,
      memoSkipped: 0,
      partyOutboundDollars: 0,
    };
  }

  const perLeader = new Map<string, LeaderAgg>();
  function getLeader(id: string): LeaderAgg {
    let l = perLeader.get(id);
    if (!l) {
      l = { inbound: new Map(), outbound: new Map() };
      perLeader.set(id, l);
    }
    return l;
  }

  // itoth.txt — 18K inbound + 24G outbound. Layout:
  //   0 CMTE_ID  ...  5 TRANSACTION_TP  6 ENTITY_TP  ...  14 TRANSACTION_AMT
  //   15 OTHER_ID  16 TRAN_ID  17 FILE_NUM  18 MEMO_CD  ...
  let othInbound = 0;
  let othOutbound = 0;
  let othMemoSkipped = 0;
  let othPartyOutboundDollars = 0;
  console.log(`  cycle ${cycle}: scanning itoth.txt …`);
  const othRows = await streamLines(
    othPath,
    (cols) => {
      if (cols.length < 19) return;
      const cmteId = cols[0];
      const tx = cols[5];
      const entityTp = cols[6];
      const amount = Number(cols[14]) || 0;
      const otherId = cols[15];
      const memoCd = cols[18];
      if (!cmteId || amount <= 0) return;
      if (memoCd === 'X' || memoCd === 'XR') {
        if (
          leadershipIds.has(cmteId) &&
          (tx === '18K' || tx === '24G' || tx === '24K')
        ) {
          othMemoSkipped += 1;
        }
        return;
      }

      // INBOUND: filer is a LEADERSHIP PAC, transaction 18K from a PAC/COM.
      if (tx === '18K' && leadershipIds.has(cmteId) && otherId && (entityTp === 'PAC' || entityTp === 'COM')) {
        const klass = classifiedDonors.get(otherId);
        if (klass && COUNTS_AGAINST_CLASSES.has(klass)) {
          const l = getLeader(cmteId);
          l.inbound.set(otherId, (l.inbound.get(otherId) ?? 0) + amount);
          othInbound += 1;
        }
        return;
      }

      // OUTBOUND: filer is a LEADERSHIP PAC, 24G or 24K. Recipient may be
      // a candidate principal (attributed) OR a party committee
      // (denominator-only).
      if ((tx === '24G' || tx === '24K') && leadershipIds.has(cmteId) && otherId) {
        const candId = cmteToCand.get(otherId);
        const isParty = partyIds.has(otherId);
        if (!candId && !isParty) return;
        const l = getLeader(cmteId);
        l.outbound.set(otherId, (l.outbound.get(otherId) ?? 0) + amount);
        othOutbound += 1;
        if (!candId && isParty) othPartyOutboundDollars += amount;
      }
    },
    `itoth(${cycle})`,
  );

  // itpas2.txt — 24K to candidates. MEMO_CD at col 19.
  console.log(`  cycle ${cycle}: scanning itpas2.txt …`);
  let pas2Outbound = 0;
  let pas2MemoSkipped = 0;
  let pas2PartyOutboundDollars = 0;
  const pas2Rows = await streamLines(
    itpasPath,
    (cols) => {
      if (cols.length < 20) return;
      const cmteId = cols[0];
      const tx = cols[5];
      const amount = Number(cols[14]) || 0;
      const otherId = cols[15];
      const memoCd = cols[19];
      if (!cmteId || amount <= 0) return;
      if (tx !== '24K') return;
      if (!leadershipIds.has(cmteId)) return;
      if (memoCd === 'X' || memoCd === 'XR') {
        pas2MemoSkipped += 1;
        return;
      }
      const candId = cmteToCand.get(otherId);
      const isParty = partyIds.has(otherId);
      if (!candId && !isParty) return;
      const l = getLeader(cmteId);
      l.outbound.set(otherId, (l.outbound.get(otherId) ?? 0) + amount);
      pas2Outbound += 1;
      if (!candId && isParty) pas2PartyOutboundDollars += amount;
    },
    `itpas2(${cycle})`,
  );

  const memoSkipped = othMemoSkipped + pas2MemoSkipped;
  const partyOutboundDollars = othPartyOutboundDollars + pas2PartyOutboundDollars;
  console.log(
    `  cycle ${cycle}: itoth=${othRows.toLocaleString()} rows · itpas2=${pas2Rows.toLocaleString()} rows · ` +
      `inbound matches=${othInbound.toLocaleString()} · outbound matches=${(
        othOutbound + pas2Outbound
      ).toLocaleString()} ` +
      `(itoth ${othOutbound.toLocaleString()} + itpas2 ${pas2Outbound.toLocaleString()}) · ` +
      `memo-skipped=${memoSkipped.toLocaleString()} · ` +
      `party-outbound-in-denom=$${Math.round(partyOutboundDollars).toLocaleString()}`,
  );

  // Apportion.
  let leadershipActive = 0;
  let rowsAttributed = 0;
  let dollarsAttributed = 0;
  for (const [leaderId, l] of perLeader) {
    if (l.inbound.size === 0 || l.outbound.size === 0) continue;
    let totalOutbound = 0;
    for (const v of l.outbound.values()) totalOutbound += v;
    if (totalOutbound <= 0) continue;
    leadershipActive += 1;
    for (const [donorId, inAmt] of l.inbound) {
      for (const [recipCmte, outAmt] of l.outbound) {
        const share = outAmt / totalOutbound;
        const attributed = inAmt * share;
        if (attributed <= 0) continue;
        const candId = cmteToCand.get(recipCmte);
        if (!candId) continue; // party-committee shares: count in denom only
        const legId = candToLeg.get(candId);
        if (!legId) continue;
        const key = `${legId}|${donorId}|${cycle}`;
        const existing = attributions.get(key);
        if (existing) {
          existing.amount += attributed;
          existing.viaLeadershipPacs.add(leaderId);
        } else {
          attributions.set(key, {
            legislatorId: legId,
            donorCommitteeId: donorId,
            cycleYear: cycle,
            amount: attributed,
            viaLeadershipPacs: new Set([leaderId]),
          });
        }
        rowsAttributed += 1;
        dollarsAttributed += attributed;
      }
    }
  }

  console.log(
    `  cycle ${cycle}: ${perLeader.size.toLocaleString()} leadership PACs touched · ` +
      `${leadershipActive} apportioned · ${rowsAttributed.toLocaleString()} attributions · ` +
      `$${Math.round(dollarsAttributed).toLocaleString()} apportioned`,
  );
  return {
    leadershipActive,
    rowsAttributed,
    dollarsAttributed,
    memoSkipped,
    partyOutboundDollars,
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-fec-leadership-passthrough] flags: ${JSON.stringify(flags)}`);

  const candToLeg = await loadCandToLegMap();
  console.log(`[ingest-fec-leadership-passthrough] ${candToLeg.size} FEC cand → legislator`);

  const { cmteToCand, cmteName, partyIds } = loadCommitteeMaps();
  console.log(
    `[ingest-fec-leadership-passthrough] ${cmteToCand.size.toLocaleString()} principal-committee → cand · ` +
      `${partyIds.size.toLocaleString()} party committees flagged for denominator`,
  );

  // Classified donors AND leadership committee identification both come from
  // PacClassification — leadership PACs are the ones whose `class` column is
  // 'LEADERSHIP' (populated by classify-pacs / map-leadership-pacs over the
  // FEC committee master).
  const classified = await prisma.pacClassification.findMany({
    select: { committeeId: true, class: true, name: true },
  });
  const classifiedDonors = new Map<string, string>();
  const classifiedNames = new Map<string, string>();
  const leadershipIds = new Set<string>();
  for (const c of classified) {
    classifiedDonors.set(c.committeeId, c.class);
    classifiedNames.set(c.committeeId, c.name);
    if (c.class === 'LEADERSHIP') leadershipIds.add(c.committeeId);
  }
  const countsAgainstDonors = [...classifiedDonors.values()].filter((k) => COUNTS_AGAINST_CLASSES.has(k)).length;
  console.log(
    `[ingest-fec-leadership-passthrough] ${classifiedDonors.size.toLocaleString()} classified donors ` +
      `(${countsAgainstDonors.toLocaleString()} counts-against · ${leadershipIds.size.toLocaleString()} LEADERSHIP committees)`,
  );

  if (leadershipIds.size === 0) {
    console.error(
      '[ingest-fec-leadership-passthrough] no LEADERSHIP-classified committees in PacClassification — ' +
        'run `npm run scorecard:map-leadership-pacs` first.',
    );
    await prisma.$disconnect();
    return;
  }

  const attributions = new Map<string, Attribution>();
  let grandLeaders = 0;
  let grandRows = 0;
  let grandDollars = 0;
  let grandMemoSkipped = 0;
  let grandPartyOutbound = 0;
  const perCycleSummary: Array<{
    cycle: number;
    leadershipActive: number;
    rowsAttributed: number;
    dollarsAttributed: number;
  }> = [];

  for (const { cycle, dir } of CYCLE_DIRS) {
    if (flags.cycle !== null && cycle !== flags.cycle) continue;
    const r = await processCycle(
      cycle,
      dir,
      leadershipIds,
      cmteToCand,
      candToLeg,
      classifiedDonors,
      attributions,
      partyIds,
    );
    grandLeaders += r.leadershipActive;
    grandRows += r.rowsAttributed;
    grandDollars += r.dollarsAttributed;
    grandMemoSkipped += r.memoSkipped;
    grandPartyOutbound += r.partyOutboundDollars;
    perCycleSummary.push({
      cycle,
      leadershipActive: r.leadershipActive,
      rowsAttributed: r.rowsAttributed,
      dollarsAttributed: r.dollarsAttributed,
    });
  }

  console.log(
    `\n[ingest-fec-leadership-passthrough] TOTAL: ${grandLeaders.toLocaleString()} leadership PACs apportioned · ` +
      `${attributions.size.toLocaleString()} unique (leg, donor, cycle) rows · ` +
      `$${Math.round(grandDollars).toLocaleString()} apportioned · ` +
      `${grandMemoSkipped.toLocaleString()} memo rows skipped · ` +
      `$${Math.round(grandPartyOutbound).toLocaleString()} party-committee outbound counted in denom`,
  );

  console.log('\nPer-cycle:');
  for (const s of perCycleSummary) {
    console.log(
      `  ${s.cycle}: ${s.leadershipActive.toLocaleString()} leadership PACs · ${s.rowsAttributed.toLocaleString()} rows · ` +
        `$${Math.round(s.dollarsAttributed).toLocaleString()}`,
    );
  }

  // Top 20 attributions for sanity.
  const top = [...attributions.values()].sort((a, b) => b.amount - a.amount).slice(0, 20);
  const legNames = await prisma.legislator.findMany({
    where: { id: { in: [...new Set(top.map((t) => t.legislatorId))] } },
    select: { id: true, fullName: true, party: true, state: true },
  });
  const legNameMap = new Map(legNames.map((l) => [l.id, `${l.fullName} (${l.party}-${l.state})`]));
  console.log('\nTop 20 leadership-PAC pass-through attributions:');
  for (const t of top) {
    const leg = legNameMap.get(t.legislatorId) ?? t.legislatorId;
    const donor = classifiedNames.get(t.donorCommitteeId) ?? cmteName.get(t.donorCommitteeId) ?? t.donorCommitteeId;
    const lpLabel =
      t.viaLeadershipPacs.size === 1
        ? classifiedNames.get([...t.viaLeadershipPacs][0]) ??
          cmteName.get([...t.viaLeadershipPacs][0]) ??
          [...t.viaLeadershipPacs][0]
        : `${t.viaLeadershipPacs.size} leadership PACs`;
    console.log(
      `  $${Math.round(t.amount).toLocaleString().padStart(10)}  ${leg.padEnd(34)}  ← ${donor.padEnd(40)}  ${
        t.cycleYear
      }  via ${lpLabel}`,
    );
  }

  // Per-recipient totals across all cycles (top 10 for the PR report).
  const perRecip = new Map<string, number>();
  const perRecipChains = new Map<string, Map<string, number>>();
  for (const a of attributions.values()) {
    perRecip.set(a.legislatorId, (perRecip.get(a.legislatorId) ?? 0) + a.amount);
    let chainMap = perRecipChains.get(a.legislatorId);
    if (!chainMap) {
      chainMap = new Map();
      perRecipChains.set(a.legislatorId, chainMap);
    }
    for (const lp of a.viaLeadershipPacs) {
      chainMap.set(lp, (chainMap.get(lp) ?? 0) + a.amount);
    }
  }
  const topRecipIds = [...perRecip.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const recipLegs = await prisma.legislator.findMany({
    where: { id: { in: topRecipIds.map(([id]) => id) } },
    select: { id: true, fullName: true, party: true, state: true, bioguideId: true },
  });
  const recipLegMap = new Map(recipLegs.map((l) => [l.id, l]));
  console.log('\nTop 10 recipient legislators (all cycles, all donors):');
  for (const [legId, total] of topRecipIds) {
    const leg = recipLegMap.get(legId);
    const chainMap = perRecipChains.get(legId);
    const topChain = chainMap ? [...chainMap.entries()].sort((a, b) => b[1] - a[1])[0] : null;
    const chainLabel = topChain
      ? `${classifiedNames.get(topChain[0]) ?? cmteName.get(topChain[0]) ?? topChain[0]} ($${Math.round(
          topChain[1],
        ).toLocaleString()})`
      : '—';
    console.log(
      `  $${Math.round(total).toLocaleString().padStart(10)}  ${
        leg ? `${leg.fullName} (${leg.party}-${leg.state}) [${leg.bioguideId}]` : legId
      }  top chain via ${chainLabel}`,
    );
  }

  if (flags.dryRun) {
    console.log('\n[ingest-fec-leadership-passthrough] DRY RUN — no DB writes');
    await prisma.$disconnect();
    return;
  }

  // Filter to rows whose donor is in PacClassification (FK constraint).
  let skippedUnknownDonor = 0;
  const rows: Attribution[] = [];
  for (const a of attributions.values()) {
    if (!classifiedDonors.has(a.donorCommitteeId)) {
      skippedUnknownDonor += 1;
      continue;
    }
    rows.push(a);
  }
  if (skippedUnknownDonor > 0) {
    console.log(
      `[ingest-fec-leadership-passthrough] skipped ${skippedUnknownDonor.toLocaleString()} rows w/ unclassified donor`,
    );
  }

  // Scope-aware DELETE — only wipe LEADERSHIP_PASS_THROUGH, optionally per cycle.
  if (flags.cycle !== null) {
    console.log(
      `[ingest-fec-leadership-passthrough] clearing existing LEADERSHIP_PASS_THROUGH for cycle ${flags.cycle}…`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "PacContribution" WHERE "kind" = 'LEADERSHIP_PASS_THROUGH' AND "cycleYear" = $1`,
      flags.cycle,
    );
  } else {
    console.log('[ingest-fec-leadership-passthrough] clearing existing LEADERSHIP_PASS_THROUGH (all cycles)…');
    await prisma.$executeRawUnsafe(`DELETE FROM "PacContribution" WHERE "kind" = 'LEADERSHIP_PASS_THROUGH'`);
  }

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((r, idx) => {
        const base = idx * 6;
        const lpArr = [...r.viaLeadershipPacs];
        params.push(
          r.legislatorId,
          r.donorCommitteeId,
          r.cycleYear,
          'LEADERSHIP_PASS_THROUGH',
          r.amount.toFixed(2),
          lpArr,
        );
        return (
          `(gen_random_uuid()::text, $${base + 1}, $${base + 2}, $${base + 3}, ` +
          `$${base + 4}::"ContributionKind", $${base + 5}::numeric, $${base + 6}::text[], NOW())`
        );
      })
      .join(',');
    const sql =
      `INSERT INTO "PacContribution" ` +
      `("id", "legislatorId", "donorCommitteeId", "cycleYear", "kind", "amount", "viaJfcCommitteeIds", "createdAt") ` +
      `VALUES ${values} ` +
      `ON CONFLICT ("legislatorId", "donorCommitteeId", "cycleYear", "kind") DO UPDATE SET ` +
      `"amount" = EXCLUDED."amount", "viaJfcCommitteeIds" = EXCLUDED."viaJfcCommitteeIds"`;
    await prisma.$executeRawUnsafe(sql, ...params);
    written += slice.length;
    if (written % 10000 === 0 || i + BATCH >= rows.length) {
      console.log(`  inserted ${written.toLocaleString()}/${rows.length.toLocaleString()}`);
    }
  }
  console.log(`[ingest-fec-leadership-passthrough] ✓ wrote ${written.toLocaleString()} LEADERSHIP_PASS_THROUGH rows`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
