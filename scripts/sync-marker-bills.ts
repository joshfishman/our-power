// scripts/sync-marker-bills.ts
//
// Manual CLI sync for scorecard marker bills via LegiScan.
//
// PRIMARY PATH — live LegiScan API (default):
//   Requires LEGISCAN_API_KEY in .env.local. Real-time data, ~80 calls
//   per full sync (well under the 30k/mo free-tier ceiling).
//
// FALLBACK PATH — on-disk bulk dataset (--source=bulk):
//   Reads from LEGISCAN_DATASET_DIR. Use when the API is unavailable,
//   when traveling offline, or for validation against a frozen snapshot.
//   Same JSON shape as the API, weekly refresh from
//   https://legiscan.com/datasets.
//
// Usage:
//   npx tsx scripts/sync-marker-bills.ts                       # both jurisdictions (API)
//   npx tsx scripts/sync-marker-bills.ts --jurisdiction=CA
//   npx tsx scripts/sync-marker-bills.ts --jurisdiction=FEDERAL
//   npx tsx scripts/sync-marker-bills.ts --dry-run             # no DB writes
//   npx tsx scripts/sync-marker-bills.ts --bill=AB-2200        # one bill only
//   npx tsx scripts/sync-marker-bills.ts --source=bulk         # offline / fallback
//
// Source can also be set via env LEGISCAN_SOURCE=api|bulk; the flag wins.
//
// Scheduling is deferred: this script is intentionally CLI-only and
// not wired to Vercel Cron or any automated runner. Once the data
// pipeline is proven, register a cron in vercel.json (or equivalent)
// pointing at `npx tsx scripts/sync-marker-bills.ts` with appropriate
// flags. Until then, run it by hand and review the summary output.
//
// Refuses to run against MarkerBills with isProvisional=true. Verify
// each bill on Congress.gov / leginfo.legislature.ca.gov first, then
// flip isProvisional=false in the seed and re-run prisma:seed-scorecard.

// MUST be the first import: side-effect loads .env.local + .env so that
// downstream modules (notably the prisma singleton that LegiscanClient
// and LegiscanBulkClient pull in) see DATABASE_URL when their top-level
// runs. In ESM, all imports run before top-level statements, so a bare
// `dotenv.config()` call below the imports would run too late.
import './load-env';

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { LegiscanClient } from '../src/lib/scorecard/clients/legiscan';
import { LegiscanBulkClient } from '../src/lib/scorecard/clients/legiscan-bulk';
import type {
  LegislativeDataSource,
  NormalizedBill,
  NormalizedSponsor,
  NormalizedRollCall,
  VotePosition,
} from '../src/lib/scorecard/clients/types';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

type SourceMode = 'api' | 'bulk';

interface CliFlags {
  jurisdiction: 'FEDERAL' | 'CA' | 'BOTH';
  dryRun: boolean;
  billNumber: string | null;
  source: SourceMode;
}

function parseFlags(argv: string[]): CliFlags {
  const envSource = (process.env.LEGISCAN_SOURCE ?? '').toLowerCase();
  const initialSource: SourceMode = envSource === 'bulk' ? 'bulk' : 'api';
  const flags: CliFlags = {
    jurisdiction: 'BOTH',
    dryRun: false,
    billNumber: null,
    source: initialSource,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--jurisdiction=')) {
      const v = arg.split('=')[1].toUpperCase();
      if (v === 'FEDERAL' || v === 'CA' || v === 'BOTH') flags.jurisdiction = v as CliFlags['jurisdiction'];
    } else if (arg.startsWith('--bill=')) {
      flags.billNumber = arg.split('=')[1];
    } else if (arg.startsWith('--source=')) {
      const v = arg.split('=')[1].toLowerCase();
      if (v === 'api' || v === 'bulk') flags.source = v;
    }
  }
  return flags;
}

function buildClient(source: SourceMode): LegislativeDataSource {
  if (source === 'bulk') {
    return new LegiscanBulkClient();
  }
  return new LegiscanClient();
}

interface SyncStats {
  billsProcessed: number;
  billsSkippedProvisional: number;
  billsNotFound: number;
  achievementsWritten: number;
  achievementsCleared: number;
  rollCallsWritten: number;
  rollCallVotesWritten: number;
  unmappedSponsors: number;
  unmappedVoters: number;
  errors: number;
}

const newStats = (): SyncStats => ({
  billsProcessed: 0,
  billsSkippedProvisional: 0,
  billsNotFound: 0,
  achievementsWritten: 0,
  achievementsCleared: 0,
  rollCallsWritten: 0,
  rollCallVotesWritten: 0,
  unmappedSponsors: 0,
  unmappedVoters: 0,
  errors: 0,
});

/**
 * Looks up a Legislator by LegiScan people_id. If we don't yet have
 * that mapping, attempts a name + jurisdiction match against existing
 * Legislator rows and backfills legiscanPeopleId on hit.
 *
 * Returns null if no match (caller increments unmapped counter).
 */
async function resolveLegislator(
  externalPersonId: string,
  jurisdiction: 'FEDERAL' | 'CA',
  fullName: string,
  party: string | null,
): Promise<{ id: string } | null> {
  const peopleIdNum = Number(externalPersonId);

  // Direct hit on legiscanPeopleId.
  const direct = await prisma.legislator.findUnique({
    where: { legiscanPeopleId: peopleIdNum },
    select: { id: true },
  });
  if (direct) return direct;

  // Name match. Be conservative: jurisdiction must match, full name must match
  // (case-insensitive), and party must match if both sides have a value.
  const candidates = await prisma.legislator.findMany({
    where: {
      jurisdiction,
      fullName: { equals: fullName, mode: 'insensitive' },
    },
    select: { id: true, party: true },
  });
  if (candidates.length === 0) return null;
  if (candidates.length > 1) return null; // Ambiguous — let it stay unmapped rather than guess.
  const candidate = candidates[0];
  if (party && candidate.party && party.charAt(0).toUpperCase() !== candidate.party) {
    // Party mismatch; refuse to backfill.
    return null;
  }
  await prisma.legislator.update({
    where: { id: candidate.id },
    data: { legiscanPeopleId: peopleIdNum },
  });
  return { id: candidate.id };
}

/**
 * Three-state position determination per (legislator, marker bill).
 *
 * Returns the actionTaken state PLUS legacy `achieved` for back-compat:
 *  - ACTED_FOR    — they did the right thing per the marker (positive evidence)
 *  - ACTED_AGAINST — they took an opposite position with positive evidence
 *                    (only meaningful when there's a recorded vote roll)
 *  - NO_RECORD    — no positive evidence either way; we just don't know
 *
 * NO_RECORD return = caller should NOT write a MarkerAchievement row.
 * Absence of a row IS the NO_RECORD state in the rendering layer.
 */
type AchievementStatus = 'ACTED_FOR' | 'ACTED_AGAINST' | 'NO_RECORD';
type SponsorTierForAchievement = NormalizedSponsor['tier'];

function determineAchievement(
  actionType: string,
  legislatorId: string,
  bill: NormalizedBill,
  sponsorMap: Map<string, { tier: NormalizedSponsor['tier']; rawTier: NormalizedSponsor['rawTier'] }>,
  legislatorVotes: Map<string, VotePosition>,
): {
  achieved: boolean;
  actionTaken: AchievementStatus;
  sponsorTier: SponsorTierForAchievement | null;
  evidence: { type: 'COSPONSOR' | 'VOTE'; sourceUrl: string | null; notes: string | null } | null;
} {
  const sponsor = sponsorMap.get(legislatorId);
  const vote = legislatorVotes.get(legislatorId);

  switch (actionType) {
    case 'COSPONSOR':
    case 'AUTHOR':
    case 'PRINCIPAL_COAUTHOR':
    case 'COAUTHOR':
    case 'SPONSOR':
      // Sponsorship is the strongest signal — wins if present.
      if (sponsor) {
        return {
          achieved: true,
          actionTaken: 'ACTED_FOR',
          sponsorTier: sponsor.tier,
          evidence: {
            type: 'COSPONSOR',
            sourceUrl: bill.sourceUrl,
            notes: `LegiScan sponsor_type_id=${sponsor.rawTier}`,
          },
        };
      }
      // No sponsorship — but a floor / committee YES vote on the bill
      // counts as positive evidence too. Same rule that VOTE_YES markers
      // already follow.
      if (vote === 'YES') {
        return {
          achieved: true,
          actionTaken: 'ACTED_FOR',
          sponsorTier: null,
          evidence: { type: 'VOTE', sourceUrl: bill.sourceUrl, notes: 'Voted yes per LegiScan roll call' },
        };
      }
      // Any other recorded position (NO, NOT_VOTING in committee, etc.)
      // is positive evidence of opposition — they had the chance and
      // declined to support.
      if (vote !== undefined) {
        return {
          achieved: false,
          actionTaken: 'ACTED_AGAINST',
          sponsorTier: null,
          evidence: {
            type: 'VOTE',
            sourceUrl: bill.sourceUrl,
            notes: `Recorded ${vote} on the roll call — declined to support per LegiScan`,
          },
        };
      }
      // Truly no record — not a sponsor, not on the roll call.
      return { achieved: false, actionTaken: 'NO_RECORD', sponsorTier: null, evidence: null };

    case 'VOTE_YES':
      // Sponsors get credit even if they weren't on the committee or didn't
      // vote — putting your name on a bill is stronger evidence than a
      // floor vote. Sponsor path runs first.
      if (sponsor) {
        return {
          achieved: true,
          actionTaken: 'ACTED_FOR',
          sponsorTier: sponsor.tier,
          evidence: {
            type: 'COSPONSOR',
            sourceUrl: bill.sourceUrl,
            notes: `Sponsor tier ${sponsor.tier} (LegiScan sponsor_type_id=${sponsor.rawTier})`,
          },
        };
      }
      if (vote === 'YES') {
        return {
          achieved: true,
          actionTaken: 'ACTED_FOR',
          sponsorTier: null,
          evidence: { type: 'VOTE', sourceUrl: bill.sourceUrl, notes: 'Voted yes per LegiScan roll call' },
        };
      }
      if (vote !== undefined) {
        // Recorded any non-yes position on the roll call — they had the
        // chance and declined. ACTED_AGAINST captures NOT_VOTING members
        // who effectively denied the bill the vote it needed.
        return {
          achieved: false,
          actionTaken: 'ACTED_AGAINST',
          sponsorTier: null,
          evidence: {
            type: 'VOTE',
            sourceUrl: bill.sourceUrl,
            notes: `Recorded ${vote} on the roll call — declined to support per LegiScan`,
          },
        };
      }
      // No roll-call entry at all and not a sponsor — they had no chance.
      return { achieved: false, actionTaken: 'NO_RECORD', sponsorTier: null, evidence: null };

    case 'VOTE_NO':
      if (sponsor) {
        // Inverse of VOTE_YES: a sponsor of a bill our marker wants
        // OPPOSED is acting against the marker. Surface that.
        return {
          achieved: false,
          actionTaken: 'ACTED_AGAINST',
          sponsorTier: sponsor.tier,
          evidence: {
            type: 'COSPONSOR',
            sourceUrl: bill.sourceUrl,
            notes: `Sponsor tier ${sponsor.tier} on a bill the marker opposes`,
          },
        };
      }
      if (vote === 'NO') {
        return {
          achieved: true,
          actionTaken: 'ACTED_FOR',
          sponsorTier: null,
          evidence: { type: 'VOTE', sourceUrl: bill.sourceUrl, notes: 'Voted no per LegiScan roll call' },
        };
      }
      if (vote !== undefined) {
        return {
          achieved: false,
          actionTaken: 'ACTED_AGAINST',
          sponsorTier: null,
          evidence: {
            type: 'VOTE',
            sourceUrl: bill.sourceUrl,
            notes: `Recorded ${vote} on the roll call — declined to vote no per LegiScan`,
          },
        };
      }
      return { achieved: false, actionTaken: 'NO_RECORD', sponsorTier: null, evidence: null };

    default:
      return { achieved: false, actionTaken: 'NO_RECORD', sponsorTier: null, evidence: null };
  }
}

async function syncBill(
  client: LegislativeDataSource,
  markerBill: {
    id: string;
    legiscanBillId: number | null;
    billNumber: string;
    actionType: string;
    marker: { id: string; plank: { jurisdiction: 'FEDERAL' | 'CA' } };
  },
  flags: CliFlags,
  stats: SyncStats,
): Promise<void> {
  const jurisdiction = markerBill.marker.plank.jurisdiction;

  let bill: NormalizedBill | null = null;
  if (markerBill.legiscanBillId) {
    bill = await client.getBillById(String(markerBill.legiscanBillId));
  }
  if (!bill) {
    bill = await client.findBillByNumber({ jurisdiction, billNumber: markerBill.billNumber });
  }
  if (!bill) {
    stats.billsNotFound += 1;
    console.warn(`  [skip] ${markerBill.billNumber}: not found on LegiScan`);
    return;
  }

  // Persist the legiscanBillId + procedural history for next time.
  // procedureHistory always overwrites (LegiScan is source of truth for
  // the timeline); legiscanBillId only writes when missing or mismatched.
  console.log(
    `  [sync] ${markerBill.billNumber}: bill.procedureHistory has ${bill.procedureHistory?.length ?? 0} entries`,
  );
  if (!flags.dryRun) {
    const updates: { legiscanBillId?: number; procedureHistory?: unknown } = {};
    if (!markerBill.legiscanBillId || String(markerBill.legiscanBillId) !== bill.externalBillId) {
      updates.legiscanBillId = Number(bill.externalBillId);
    }
    updates.procedureHistory = bill.procedureHistory;
    try {
      await prisma.markerBill.update({
        where: { id: markerBill.id },
        data: updates as { legiscanBillId?: number; procedureHistory?: object },
      });
      console.log(`  [sync] ${markerBill.billNumber}: persisted ${bill.procedureHistory?.length ?? 0} history entries`);
    } catch (err) {
      console.error(`  [sync] ${markerBill.billNumber}: FAILED to persist procedureHistory`, err);
    }
  }

  // Resolve all sponsors and roll-call voters into our Legislator ids.
  // sponsorOrder is preserved on the map so we can write BillSponsorship
  // rows with authorship rank — drives the "Author" vs "Cosponsor" UI split.
  const sponsorMap = new Map<
    string,
    { tier: NormalizedSponsor['tier']; rawTier: NormalizedSponsor['rawTier']; sponsorOrder: number | null }
  >();
  for (const s of bill.sponsors) {
    const leg = await resolveLegislator(s.externalPersonId, jurisdiction, s.name, s.party);
    if (leg) {
      sponsorMap.set(leg.id, {
        tier: s.tier,
        rawTier: s.rawTier,
        sponsorOrder: s.sponsorOrder ?? null,
      });
    } else {
      stats.unmappedSponsors += 1;
    }
  }

  // Persist BillSponsorship rows so the per-bill page can render Authors /
  // Cosponsors with full attribution per bill (MarkerAchievement is per
  // marker, can't distinguish which of a marker's bills triggered credit).
  if (!flags.dryRun) {
    for (const [legislatorId, s] of sponsorMap.entries()) {
      const rawId = typeof s.rawTier === 'number' ? s.rawTier : Number(s.rawTier);
      await prisma.billSponsorship.upsert({
        where: {
          billId_legislatorId: {
            billId: markerBill.id,
            legislatorId,
          },
        },
        create: {
          billId: markerBill.id,
          legislatorId,
          sponsorTier: s.tier,
          rawSponsorTypeId: Number.isFinite(rawId) ? rawId : null,
          sponsorOrder: s.sponsorOrder,
        },
        update: {
          sponsorTier: s.tier,
          rawSponsorTypeId: Number.isFinite(rawId) ? rawId : null,
          sponsorOrder: s.sponsorOrder,
        },
      });
    }
  }

  // Per-legislator vote position across all roll calls (use the most recent
  // vote we see; if no roll calls exist, the map stays empty).
  const legislatorVotes = new Map<string, VotePosition>();
  const voteRowsToWrite: Array<{
    rollCall: NormalizedRollCall;
    legislatorId: string;
    position: VotePosition;
  }> = [];
  for (const rc of bill.rollCalls) {
    for (const v of rc.votes) {
      const leg = await resolveLegislator(v.externalPersonId, jurisdiction, /* fullName */ '', null);
      if (!leg) {
        stats.unmappedVoters += 1;
        continue;
      }
      legislatorVotes.set(leg.id, v.position);
      voteRowsToWrite.push({ rollCall: rc, legislatorId: leg.id, position: v.position });
    }
  }

  // Write BillVote rows.
  if (!flags.dryRun) {
    for (const v of voteRowsToWrite) {
      await prisma.billVote.upsert({
        where: {
          billId_legislatorId_voteContext: {
            billId: markerBill.id,
            legislatorId: v.legislatorId,
            voteContext: v.rollCall.description,
          },
        },
        create: {
          billId: markerBill.id,
          legislatorId: v.legislatorId,
          position: v.position,
          voteDate: v.rollCall.date ? new Date(v.rollCall.date) : null,
          voteContext: v.rollCall.description,
          sourceUrl: v.rollCall.sourceUrl,
          isProvisional: false,
        },
        update: {
          position: v.position,
          voteDate: v.rollCall.date ? new Date(v.rollCall.date) : null,
          sourceUrl: v.rollCall.sourceUrl,
          isProvisional: false,
        },
      });
      stats.rollCallVotesWritten += 1;
    }
    stats.rollCallsWritten += bill.rollCalls.length;
  }

  // Compute MarkerAchievement for the union of legislators we observed
  // (sponsors + voters). For each observed legislator, write either an
  // ACTED_FOR row (positive achievement) or an ACTED_AGAINST row (recorded
  // opposition — only fires for VOTE_YES/VOTE_NO action types where the
  // recorded vote went the wrong way). NO_RECORD legislators never get a
  // row — absence in the table is the truthful state.
  const observed = new Set<string>([...sponsorMap.keys(), ...legislatorVotes.keys()]);
  for (const legislatorId of observed) {
    const result = determineAchievement(markerBill.actionType, legislatorId, bill, sponsorMap, legislatorVotes);
    if (result.actionTaken === 'NO_RECORD' || !result.evidence) continue;

    if (!flags.dryRun) {
      await prisma.markerAchievement.upsert({
        where: {
          legislatorId_markerId: {
            legislatorId,
            markerId: markerBill.marker.id,
          },
        },
        create: {
          legislatorId,
          markerId: markerBill.marker.id,
          achieved: result.achieved,
          actionTaken: result.actionTaken,
          sponsorTier: result.sponsorTier,
          evidenceType: result.evidence.type,
          evidenceSourceUrl: result.evidence.sourceUrl,
          evidenceNotes: result.evidence.notes,
          // verifiedAt left null — Phase 6 verification gate must flip this
          // before any score derived from this achievement is published.
        },
        update: {
          achieved: result.achieved,
          actionTaken: result.actionTaken,
          sponsorTier: result.sponsorTier,
          evidenceType: result.evidence.type,
          evidenceSourceUrl: result.evidence.sourceUrl,
          evidenceNotes: result.evidence.notes,
        },
      });
      stats.achievementsWritten += 1;
    }
  }

  stats.billsProcessed += 1;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[sync-marker-bills] flags: ${JSON.stringify(flags)}`);

  const where: {
    isProvisional: boolean;
    billNumber?: string;
    marker?: { plank: { jurisdiction: 'FEDERAL' | 'CA' } };
  } = { isProvisional: false };
  if (flags.billNumber) where.billNumber = flags.billNumber;
  if (flags.jurisdiction !== 'BOTH') {
    where.marker = { plank: { jurisdiction: flags.jurisdiction } };
  }

  const allBills = await prisma.markerBill.findMany({
    include: { marker: { include: { plank: { select: { jurisdiction: true } } } } },
  });
  const provisionalCount = allBills.filter((b) => b.isProvisional).length;
  const eligibleBills = allBills.filter((b) => {
    if (b.isProvisional) return false;
    if (flags.billNumber && b.billNumber !== flags.billNumber) return false;
    if (flags.jurisdiction !== 'BOTH' && b.marker.plank.jurisdiction !== flags.jurisdiction) return false;
    return true;
  });

  console.log(
    `[sync-marker-bills] ${eligibleBills.length} eligible bills (${provisionalCount} provisional bills skipped)`,
  );

  if (eligibleBills.length === 0) {
    console.log(
      `[sync-marker-bills] No eligible bills. Flip isProvisional=false on bills you've verified, then re-run prisma:seed-scorecard.`,
    );
    return;
  }

  const client = buildClient(flags.source);
  console.log(`[sync-marker-bills] using source: ${client.name}`);
  const stats = newStats();

  for (const bill of eligibleBills) {
    console.log(`  [bill] ${bill.marker.plank.jurisdiction} ${bill.billNumber} — ${bill.billTitle}`);
    try {
      await syncBill(client, bill, flags, stats);
    } catch (err) {
      stats.errors += 1;
      console.error(`  [error] ${bill.billNumber}: ${err instanceof Error ? err.message : err}`);
    }
  }

  stats.billsSkippedProvisional = provisionalCount;
  console.log(`[sync-marker-bills] summary: ${JSON.stringify(stats, null, 2)}`);
  if (flags.dryRun) {
    console.log('[sync-marker-bills] DRY RUN — no DB writes performed.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
