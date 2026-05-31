// v1.8.6 (audit #33) — JFC (Joint Fundraising Committee) pass-through attribution.
//
// Bug fixes from the methodology audit (2026-05-29):
//   1. PARTY-COMMITTEE OUTBOUND was being silently dropped from the
//      apportionment denominator. JFCs like "Trump Victory" or "Nancy
//      Pelosi Victory Fund" route material shares of their inbound to
//      DCCC/NRCC/DSCC/NRSC + state parties — committees that aren't
//      candidate principals. The old code skipped those outbound rows
//      entirely (cmteToCand miss → return). That made totalOutbound
//      = candidate-only, which OVERSTATED each candidate's share and
//      inflated the corp-PAC dollars attributed to them. Fix: track
//      party-committee outbound in the totalOutbound denominator while
//      still attributing only to candidate-principal recipients.
//   2. MEMO_CD ROWS were being double-counted. FEC bulk uses MEMO_CD =
//      'X' or 'XR' on memo entries — rows that re-describe a parent
//      transaction (e.g., the JFC line of a contribution itemized on
//      Schedule A by both the JFC and a participating committee).
//      Reading them as real transactions double-counts the dollar.
//      Fix: skip MEMO_CD IN ('X','XR') on inbound 18K and outbound
//      24G/24K in both itoth and itpas2. (Note: itoth places MEMO_CD
//      at col 18; itpas2 at col 19 — itpas2 has an extra CAND_ID col.)
//   3. NUMERATOR-ONLY ASYMMETRY: see (1). With party outbound out of
//      the denominator, the per-candidate share was a numerator that
//      didn't reflect the JFC's actual distribution pattern.
//   4. TRANSACTION_TP CHECK: itoth handles both 24G and 24K (correct);
//      itpas2 carries only 24K (in-kind 24G doesn't appear there per
//      FEC schema) — confirmed and left as-is.
//
// Verification on 2024 itoth.txt:
//   - 24K/24G rows with MEMO_CD = 'X': 8,974 (memo double-counts)
//   - 18K rows with MEMO_CD = 'X': 488 (inbound memo double-counts)
// On 2024 itpas2.txt:
//   - 24K rows with MEMO_CD = 'X': 6,549
//
// ─── original v1.7.2 notes preserved below ─────────────────────────────
//
// v1.7.2 — JFC (Joint Fundraising Committee) pass-through attribution.
//
// Closes a known gap in the v1.7.1 PAC score: when a corporate PAC routes
// money through a JFC to a candidate, the dollars currently land in the
// candidate's "DIRECT" bucket attributed to the JFC itself (not the corp
// PAC). High-volume fundraisers can score artificially clean because their
// JFC intake looks like generic "leadership PAC" or party committee money
// rather than tracing back to corporate donors.
//
// Approach (per cycle, per JFC J):
//   1. INBOUND: sum 18K contributions into J from each PAC (entity_tp='PAC')
//      where the donor PAC is classified CORPORATE / DARK_MONEY /
//      FOREIGN_POLICY in PacClassification.
//   2. OUTBOUND: sum 24G+24K contributions from J to each candidate
//      principal committee.
//   3. APPORTION: for each (donor d, recipient candidate r),
//         attributed = inbound_from_d * (outbound_to_r / total_outbound)
//      Aggregate per (legislatorId, donorCommitteeId, cycleYear) across
//      all JFCs the donor went through. Track JFC committee ids in
//      viaJfcCommitteeIds for transparency.
//
// FEC bulk file roles:
//   - cm.txt:     committee master. CMTE_DSGN='J' identifies JFCs;
//                  CMTE_DSGN='P' identifies candidate principal committees
//                  (with CAND_ID at col 14).
//   - itpas2.txt: contributions to candidates (24K from JFC → candidate).
//                  Contains a subset of JFC outbound (only the direct-to-
//                  cand path); 24G transfers don't appear here.
//   - itoth.txt:  other committee transactions. THIS is where 18K inbound
//                  (PAC → JFC) and 24G outbound (JFC → cand) live.
//
// Transaction code reference (FEC bulk):
//   18K — Contribution from Other Federal Committee
//          (when CMTE_ID is a JFC + ENTITY_TP='PAC', this is INBOUND to JFC)
//   24G — Transfer to affiliated committee (JFC outbound to participants)
//   24K — Direct PAC contribution (JFC outbound to cand principal in itpas2)
//
// NOTE on the brief: the original spec named transaction code 22Y as the
// inbound signal. 22Y ("Non-federal share of an allocated event") is not
// the right code in FEC bulk semantics — PAC contributions to a JFC are
// reported with transaction code 18K, with ENTITY_TP='PAC' on the filer
// side identifying the contributor as a committee. Using 18K here matches
// the actual FEC data shape (verified against 2018/2020/2022/2024 itoth.txt).
//
// Run:
//   npm run scorecard:ingest-fec-jfc-passthrough
//   npm run scorecard:ingest-fec-jfc-passthrough -- --dry-run
//   npm run scorecard:ingest-fec-jfc-passthrough -- --cycle=2020

import './load-env';
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// v1.8.12 — cycles parameterized. Defaults cover 2018→2026; missing
// directories are silently skipped by the existsSync guard inside the read
// loop. Single cycle via `--cycle=2026`.
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

// Build {fec_candidate_id → legislator_id} from Legislator.fecIds.
async function loadCandToLegMap(): Promise<Map<string, string>> {
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, fecIds: true },
  });
  const map = new Map<string, string>();
  for (const l of legs) for (const fecId of l.fecIds) if (fecId) map.set(fecId, l.id);
  return map;
}

// cm.txt columns (pipe-delimited, by index in real FEC data):
//   0 CMTE_ID  1 CMTE_NM  2 TRES_NM  3 ADDR1  4 ADDR2  5 CITY  6 ST
//   7 ZIP  8 CMTE_DSGN  9 CMTE_TP  10 CMTE_PTY_AFFILIATION
//   11 CMTE_FILING_FREQ  12 ORG_TP  13 CONNECTED_ORG_NM  14 CAND_ID
function loadCommitteeMaps(): {
  cmteToCand: Map<string, string>;
  jfcIds: Set<string>;
  cmteName: Map<string, string>;
  partyIds: Set<string>;
} {
  const cmteToCand = new Map<string, string>();
  const jfcIds = new Set<string>();
  const cmteName = new Map<string, string>();
  // CMTE_TP X = State/subordinate party committee, Y = National party
  // (DNC/RNC + DCCC/NRCC/DSCC/NRSC + state coordinating committees). Bug #1:
  // party outbound from a JFC must be counted in totalOutbound so per-candidate
  // shares are correctly proportional, even though no candidate is the recipient.
  const partyIds = new Set<string>([
    // Hill committees — hard-coded belt-and-braces in case the cm.txt walk
    // misses an older cycle for any of these IDs.
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
      if (designation === 'J') jfcIds.add(cmteId);
      if (cmteType === 'X' || cmteType === 'Y') partyIds.add(cmteId);
    }
  }
  return { cmteToCand, jfcIds, cmteName, partyIds };
}

interface JfcAgg {
  inbound: Map<string, number>; // donor committee id → $ in (classified counts-against only)
  outbound: Map<string, number>; // recipient principal committee id → $ out
}

interface Attribution {
  legislatorId: string;
  donorCommitteeId: string;
  cycleYear: number;
  amount: number;
  viaJfcs: Set<string>;
}

// Stream-parse a pipe-delimited file line-by-line, with periodic progress.
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
  jfcIds: Set<string>,
  cmteToCand: Map<string, string>,
  candToLeg: Map<string, string>,
  classifiedDonors: Map<string, string>,
  attributions: Map<string, Attribution>,
  partyIds: Set<string>,
): Promise<{
  jfcsActive: number;
  rowsAttributed: number;
  dollarsAttributed: number;
  perJfcDebug: Map<string, JfcAgg>;
  memoSkipped: number;
  partyOutboundDollars: number;
}> {
  const itpasPath = path.join(dir, 'itpas2.txt');
  const othPath = path.join(dir, 'itoth.txt');
  if (!fs.existsSync(itpasPath)) {
    console.warn(`  cycle ${cycle}: missing itpas2.txt — skipping`);
    return {
      jfcsActive: 0,
      rowsAttributed: 0,
      dollarsAttributed: 0,
      perJfcDebug: new Map(),
      memoSkipped: 0,
      partyOutboundDollars: 0,
    };
  }
  if (!fs.existsSync(othPath)) {
    console.warn(
      `  cycle ${cycle}: missing itoth.txt — skipping (download oth${cycle
        .toString()
        .slice(-2)}.zip from FEC bulk to enable JFC inbound)`,
    );
    return {
      jfcsActive: 0,
      rowsAttributed: 0,
      dollarsAttributed: 0,
      perJfcDebug: new Map(),
      memoSkipped: 0,
      partyOutboundDollars: 0,
    };
  }

  const perJfc = new Map<string, JfcAgg>();
  function getJfc(id: string): JfcAgg {
    let j = perJfc.get(id);
    if (!j) {
      j = { inbound: new Map(), outbound: new Map() };
      perJfc.set(id, j);
    }
    return j;
  }

  // itoth.txt — 18K inbound (PAC → JFC), 24G outbound (JFC → recipient).
  //
  // itoth row layout (same pipe schema as itpas2):
  //   0 CMTE_ID (filer)  1 AMNDT_IND  2 RPT_TP  3 TX_PGI  4 IMG_NUM
  //   5 TRANSACTION_TP  6 ENTITY_TP  7 NAME  8 CITY  9 STATE  10 ZIP
  //   11 EMPLOYER  12 OCCUPATION  13 TRANSACTION_DT  14 TRANSACTION_AMT
  //   15 OTHER_ID  16 TRAN_ID  17 FILE_NUM  18 MEMO_CD  19 MEMO_TEXT
  //   20 SUB_ID
  let othRows = 0;
  let othInbound = 0;
  let othOutbound = 0;
  let othMemoSkipped = 0;
  let othPartyOutboundDollars = 0;
  console.log(`  cycle ${cycle}: scanning itoth.txt …`);
  othRows = await streamLines(
    othPath,
    (cols) => {
      if (cols.length < 19) return;
      const cmteId = cols[0];
      const tx = cols[5];
      const entityTp = cols[6];
      const amount = Number(cols[14]) || 0;
      const otherId = cols[15];
      // itoth.txt MEMO_CD lives at index 18. Memo rows ('X' / 'XR') re-state a
      // parent transaction already itemized elsewhere — counting them double-
      // counts the dollar. Skip on inbound 18K and outbound 24G/24K alike.
      const memoCd = cols[18];
      if (!cmteId || amount <= 0) return;
      if (memoCd === 'X' || memoCd === 'XR') {
        if (
          jfcIds.has(cmteId) &&
          (tx === '18K' || tx === '24G' || tx === '24K')
        ) {
          othMemoSkipped += 1;
        }
        return;
      }

      // INBOUND: filer is a JFC, transaction is 18K (contribution from another
      // federal committee), entity type is PAC (or COM = committee).
      if (tx === '18K' && jfcIds.has(cmteId) && otherId && (entityTp === 'PAC' || entityTp === 'COM')) {
        const klass = classifiedDonors.get(otherId);
        if (klass && COUNTS_AGAINST_CLASSES.has(klass)) {
          const j = getJfc(cmteId);
          j.inbound.set(otherId, (j.inbound.get(otherId) ?? 0) + amount);
          othInbound += 1;
        }
        return;
      }

      // OUTBOUND: filer is a JFC, transaction is 24G or 24K. Recipient may be
      // a candidate principal (gets attributed) OR a party committee like
      // DCCC/NRCC (only contributes to the totalOutbound denominator so the
      // candidate shares are correctly proportional — see bug #1 in the
      // header comment).
      if ((tx === '24G' || tx === '24K') && jfcIds.has(cmteId) && otherId) {
        const candId = cmteToCand.get(otherId);
        const isParty = partyIds.has(otherId);
        if (!candId && !isParty) return;
        const j = getJfc(cmteId);
        j.outbound.set(otherId, (j.outbound.get(otherId) ?? 0) + amount);
        othOutbound += 1;
        if (!candId && isParty) othPartyOutboundDollars += amount;
      }
    },
    `itoth(${cycle})`,
  );

  // itpas2.txt — additional 24K outbound from JFCs (recorded on the
  // contributions-to-candidates schedule). Many JFCs split between itoth and
  // itpas2 depending on filer convention. itpas2 carries only 24K (in-kind
  // 24G isn't reported here per FEC schema — verified against 2024 bulk).
  // itpas2 schema differs from itoth: CAND_ID at col 16, FILE_NUM col 18,
  // MEMO_CD col 19, MEMO_TEXT col 20.
  console.log(`  cycle ${cycle}: scanning itpas2.txt …`);
  let pas2Rows = 0;
  let pas2Outbound = 0;
  let pas2MemoSkipped = 0;
  let pas2PartyOutboundDollars = 0;
  pas2Rows = await streamLines(
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
      if (!jfcIds.has(cmteId)) return;
      if (memoCd === 'X' || memoCd === 'XR') {
        pas2MemoSkipped += 1;
        return;
      }
      const candId = cmteToCand.get(otherId);
      const isParty = partyIds.has(otherId);
      if (!candId && !isParty) return;
      const j = getJfc(cmteId);
      j.outbound.set(otherId, (j.outbound.get(otherId) ?? 0) + amount);
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
  let jfcsActive = 0;
  let rowsAttributed = 0;
  let dollarsAttributed = 0;
  for (const [jfcId, j] of perJfc) {
    if (j.inbound.size === 0 || j.outbound.size === 0) continue;
    let totalOutbound = 0;
    for (const v of j.outbound.values()) totalOutbound += v;
    if (totalOutbound <= 0) continue;
    jfcsActive += 1;
    for (const [donorId, inAmt] of j.inbound) {
      for (const [recipCmte, outAmt] of j.outbound) {
        const share = outAmt / totalOutbound;
        const attributed = inAmt * share;
        if (attributed <= 0) continue;
        const candId = cmteToCand.get(recipCmte);
        if (!candId) continue;
        const legId = candToLeg.get(candId);
        if (!legId) continue;
        const key = `${legId}|${donorId}|${cycle}`;
        const existing = attributions.get(key);
        if (existing) {
          existing.amount += attributed;
          existing.viaJfcs.add(jfcId);
        } else {
          attributions.set(key, {
            legislatorId: legId,
            donorCommitteeId: donorId,
            cycleYear: cycle,
            amount: attributed,
            viaJfcs: new Set([jfcId]),
          });
        }
        rowsAttributed += 1;
        dollarsAttributed += attributed;
      }
    }
  }

  console.log(
    `  cycle ${cycle}: ${perJfc.size.toLocaleString()} JFCs touched · ` +
      `${jfcsActive} apportioned · ${rowsAttributed.toLocaleString()} attributions · ` +
      `$${Math.round(dollarsAttributed).toLocaleString()} apportioned`,
  );
  return {
    jfcsActive,
    rowsAttributed,
    dollarsAttributed,
    perJfcDebug: perJfc,
    memoSkipped,
    partyOutboundDollars,
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-fec-jfc-passthrough] flags: ${JSON.stringify(flags)}`);

  const candToLeg = await loadCandToLegMap();
  console.log(`[ingest-fec-jfc-passthrough] ${candToLeg.size} FEC cand → legislator`);

  const { cmteToCand, jfcIds, cmteName, partyIds } = loadCommitteeMaps();
  console.log(
    `[ingest-fec-jfc-passthrough] ${cmteToCand.size.toLocaleString()} principal-committee → cand · ` +
      `${jfcIds.size.toLocaleString()} JFC committees identified · ` +
      `${partyIds.size.toLocaleString()} party committees flagged for denominator`,
  );

  const classified = await prisma.pacClassification.findMany({
    select: { committeeId: true, class: true, name: true },
  });
  const classifiedDonors = new Map<string, string>();
  const classifiedNames = new Map<string, string>();
  for (const c of classified) {
    classifiedDonors.set(c.committeeId, c.class);
    classifiedNames.set(c.committeeId, c.name);
  }
  const countsAgainstDonors = [...classifiedDonors.values()].filter((k) => COUNTS_AGAINST_CLASSES.has(k)).length;
  console.log(
    `[ingest-fec-jfc-passthrough] ${classifiedDonors.size.toLocaleString()} classified donors (${countsAgainstDonors.toLocaleString()} counts-against)`,
  );

  const attributions = new Map<string, Attribution>();
  let grandJfcs = 0;
  let grandRows = 0;
  let grandDollars = 0;
  let grandMemoSkipped = 0;
  let grandPartyOutbound = 0;

  for (const { cycle, dir } of CYCLE_DIRS) {
    if (flags.cycle !== null && cycle !== flags.cycle) continue;
    const r = await processCycle(
      cycle,
      dir,
      jfcIds,
      cmteToCand,
      candToLeg,
      classifiedDonors,
      attributions,
      partyIds,
    );
    grandJfcs += r.jfcsActive;
    grandRows += r.rowsAttributed;
    grandDollars += r.dollarsAttributed;
    grandMemoSkipped += r.memoSkipped;
    grandPartyOutbound += r.partyOutboundDollars;
  }

  console.log(
    `\n[ingest-fec-jfc-passthrough] TOTAL: ${grandJfcs.toLocaleString()} JFCs apportioned · ` +
      `${attributions.size.toLocaleString()} unique (leg, donor, cycle) rows · ` +
      `$${Math.round(grandDollars).toLocaleString()} apportioned · ` +
      `${grandMemoSkipped.toLocaleString()} memo rows skipped · ` +
      `$${Math.round(grandPartyOutbound).toLocaleString()} party-committee outbound counted in denom`,
  );

  // Top 20 attributions for sanity.
  const top = [...attributions.values()].sort((a, b) => b.amount - a.amount).slice(0, 20);
  const legNames = await prisma.legislator.findMany({
    where: { id: { in: [...new Set(top.map((t) => t.legislatorId))] } },
    select: { id: true, fullName: true, party: true, state: true },
  });
  const legNameMap = new Map(legNames.map((l) => [l.id, `${l.fullName} (${l.party}-${l.state})`]));
  console.log('\nTop 20 JFC pass-through attributions:');
  for (const t of top) {
    const leg = legNameMap.get(t.legislatorId) ?? t.legislatorId;
    const donor = classifiedNames.get(t.donorCommitteeId) ?? cmteName.get(t.donorCommitteeId) ?? t.donorCommitteeId;
    const jfcLabel =
      t.viaJfcs.size === 1 ? cmteName.get([...t.viaJfcs][0]) ?? [...t.viaJfcs][0] : `${t.viaJfcs.size} JFCs`;
    console.log(
      `  $${Math.round(t.amount).toLocaleString().padStart(10)}  ${leg.padEnd(34)}  ← ${donor.padEnd(40)}  ${
        t.cycleYear
      }  via ${jfcLabel}`,
    );
  }

  if (flags.dryRun) {
    console.log('\n[ingest-fec-jfc-passthrough] DRY RUN — no DB writes');
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
      `[ingest-fec-jfc-passthrough] skipped ${skippedUnknownDonor.toLocaleString()} rows w/ unclassified donor`,
    );
  }

  // Scope-aware DELETE — only wipe JFC_PASS_THROUGH, optionally per cycle.
  if (flags.cycle !== null) {
    console.log(`[ingest-fec-jfc-passthrough] clearing existing JFC_PASS_THROUGH for cycle ${flags.cycle}…`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM "PacContribution" WHERE "kind" = 'JFC_PASS_THROUGH' AND "cycleYear" = $1`,
      flags.cycle,
    );
  } else {
    console.log(`[ingest-fec-jfc-passthrough] clearing existing JFC_PASS_THROUGH (all cycles)…`);
    await prisma.$executeRawUnsafe(`DELETE FROM "PacContribution" WHERE "kind" = 'JFC_PASS_THROUGH'`);
  }

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((r, idx) => {
        const base = idx * 6;
        const jfcArr = [...r.viaJfcs];
        params.push(r.legislatorId, r.donorCommitteeId, r.cycleYear, 'JFC_PASS_THROUGH', r.amount.toFixed(2), jfcArr);
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
  console.log(`[ingest-fec-jfc-passthrough] ✓ wrote ${written.toLocaleString()} JFC_PASS_THROUGH rows`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
