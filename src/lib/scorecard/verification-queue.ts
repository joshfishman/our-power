// Query layer for the Phase 6 verification queue.
//
// `buildQueueWhere` and `buildQueueOrderBy` are pure so the filter semantics
// (especially the tier predicates, which are the whole point of the queue) can
// be asserted in tests without a database.

import prisma from '@/lib/prisma/prisma';
import type { VerificationQueueQuery } from '@/lib/validations/scorecard-verification';
import { trustTierFor, type ReviewStatus, type TrustTier } from './verification';
import { buildQueueOrderBy, buildQueueWhere, tierWhere } from './verification-filters';

export { buildQueueOrderBy, buildQueueWhere, tierWhere };
export type { QueueTier } from './verification-filters';

export interface QueueEvidenceBill {
  id: string;
  billType: string;
  billNumber: string;
  billTitle: string;
  actionType: string;
  congressNumber: number;
  publicSlug: string | null;
  /** How this legislator voted on this bill, if there is a roll call. */
  vote: { position: string; voteDate: Date | null; voteContext: string | null; sourceUrl: string | null } | null;
  /** How this legislator sponsored this bill, if at all. */
  sponsorship: { sponsorTier: string; sponsorOrder: number | null } | null;
}

export interface QueueItem {
  id: string;
  tier: TrustTier;
  reviewStatus: ReviewStatus;
  achieved: boolean;
  actionTaken: string | null;
  sponsorTier: string | null;
  evidenceType: string;
  evidenceSourceUrl: string | null;
  evidenceNotes: string | null;
  achievementScore: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  verifiedFromUrl: string | null;
  verifierEmail: string | null;
  reviewNote: string | null;
  rejectedAt: Date | null;
  updatedAt: Date;
  legislator: {
    id: string;
    fullName: string;
    jurisdiction: string;
    chamber: string;
    state: string;
    district: number | null;
    party: string;
  };
  marker: {
    id: string;
    name: string;
    markerType: string;
    description: string;
    methodologyNotes: string | null;
    isRepublicanAlternative: boolean;
    popularSupport: number | null;
    plank: { number: number; name: string; slug: string };
  };
  bills: QueueEvidenceBill[];
}

export interface QueueTierCounts {
  RED: number;
  YELLOW: number;
  GREEN: number;
  REJECTED: number;
}

/**
 * Fetch one page of the queue plus the tier counts for the same filters.
 *
 * Roll-call and cosponsorship rows are loaded in two batched follow-up queries
 * rather than per achievement — the reviewer needs the exact evidence the
 * scoring engine consumed, but not at the cost of an N+1 per page.
 */
export async function fetchVerificationQueue(query: VerificationQueueQuery): Promise<{
  items: QueueItem[];
  total: number;
  counts: QueueTierCounts;
}> {
  const where = buildQueueWhere(query);

  // Filters that are not the tier itself, reused for the tier counts so the
  // header numbers describe the same slice the reviewer is looking at.
  const filtersWithoutTier = buildQueueWhere({ ...query, tier: 'ALL' });

  const [rows, total, red, yellow, green, rejected] = await Promise.all([
    prisma.markerAchievement.findMany({
      where,
      orderBy: buildQueueOrderBy(query.sort),
      take: query.limit,
      skip: query.offset,
      include: {
        legislator: {
          select: {
            id: true,
            fullName: true,
            jurisdiction: true,
            chamber: true,
            state: true,
            district: true,
            party: true,
          },
        },
        verifier: { select: { email: true } },
        marker: {
          include: {
            plank: { select: { number: true, name: true, slug: true } },
            bills: {
              select: {
                id: true,
                billType: true,
                billNumber: true,
                billTitle: true,
                actionType: true,
                congressNumber: true,
                publicSlug: true,
              },
            },
          },
        },
      },
    }),
    prisma.markerAchievement.count({ where }),
    prisma.markerAchievement.count({ where: { ...filtersWithoutTier, ...tierWhere('RED') } }),
    prisma.markerAchievement.count({ where: { ...filtersWithoutTier, ...tierWhere('YELLOW') } }),
    prisma.markerAchievement.count({ where: { ...filtersWithoutTier, ...tierWhere('GREEN') } }),
    prisma.markerAchievement.count({ where: { ...filtersWithoutTier, ...tierWhere('REJECTED') } }),
  ]);

  const billIds = [...new Set(rows.flatMap((row) => row.marker.bills.map((bill) => bill.id)))];
  const legislatorIds = [...new Set(rows.map((row) => row.legislatorId))];

  const [votes, sponsorships] =
    billIds.length > 0
      ? await Promise.all([
          prisma.billVote.findMany({
            where: { billId: { in: billIds }, legislatorId: { in: legislatorIds } },
            select: {
              billId: true,
              legislatorId: true,
              position: true,
              voteDate: true,
              voteContext: true,
              sourceUrl: true,
            },
          }),
          prisma.billSponsorship.findMany({
            where: { billId: { in: billIds }, legislatorId: { in: legislatorIds } },
            select: { billId: true, legislatorId: true, sponsorTier: true, sponsorOrder: true },
          }),
        ])
      : [[], []];

  const voteByKey = new Map(votes.map((vote) => [`${vote.legislatorId}:${vote.billId}`, vote]));
  const sponsorByKey = new Map(sponsorships.map((s) => [`${s.legislatorId}:${s.billId}`, s]));

  const items: QueueItem[] = rows.map((row) => ({
    id: row.id,
    tier: trustTierFor({
      verifiedAt: row.verifiedAt,
      verifierUserId: row.verifierUserId,
      reviewStatus: row.reviewStatus as ReviewStatus,
    }),
    reviewStatus: row.reviewStatus as ReviewStatus,
    achieved: row.achieved,
    actionTaken: row.actionTaken,
    sponsorTier: row.sponsorTier,
    evidenceType: row.evidenceType,
    evidenceSourceUrl: row.evidenceSourceUrl,
    evidenceNotes: row.evidenceNotes,
    achievementScore: row.achievementScore?.toString() ?? null,
    verifiedAt: row.verifiedAt,
    verifiedBy: row.verifiedBy,
    verifiedFromUrl: row.verifiedFromUrl,
    verifierEmail: row.verifier?.email ?? null,
    reviewNote: row.reviewNote,
    rejectedAt: row.rejectedAt,
    updatedAt: row.updatedAt,
    legislator: row.legislator,
    marker: {
      id: row.marker.id,
      name: row.marker.name,
      markerType: row.marker.markerType,
      description: row.marker.description,
      methodologyNotes: row.marker.methodologyNotes,
      isRepublicanAlternative: row.marker.isRepublicanAlternative,
      popularSupport: row.marker.popularSupport,
      plank: row.marker.plank,
    },
    bills: row.marker.bills.map((bill) => {
      const key = `${row.legislatorId}:${bill.id}`;
      const vote = voteByKey.get(key);
      const sponsorship = sponsorByKey.get(key);
      return {
        id: bill.id,
        billType: bill.billType,
        billNumber: bill.billNumber,
        billTitle: bill.billTitle,
        actionType: bill.actionType,
        congressNumber: bill.congressNumber,
        publicSlug: bill.publicSlug,
        vote: vote
          ? {
              position: vote.position,
              voteDate: vote.voteDate,
              voteContext: vote.voteContext,
              sourceUrl: vote.sourceUrl,
            }
          : null,
        sponsorship: sponsorship
          ? { sponsorTier: sponsorship.sponsorTier, sponsorOrder: sponsorship.sponsorOrder }
          : null,
      };
    }),
  }));

  return { items, total, counts: { RED: red, YELLOW: yellow, GREEN: green, REJECTED: rejected } };
}

/**
 * Queue item with Dates flattened to ISO strings, for handing across the
 * server/client component boundary.
 */
export type SerializedQueueItem = Omit<QueueItem, 'verifiedAt' | 'rejectedAt' | 'updatedAt' | 'bills'> & {
  verifiedAt: string | null;
  rejectedAt: string | null;
  updatedAt: string;
  bills: Array<
    Omit<QueueEvidenceBill, 'vote'> & {
      vote: (Omit<NonNullable<QueueEvidenceBill['vote']>, 'voteDate'> & { voteDate: string | null }) | null;
    }
  >;
};

export function serializeQueueItem(item: QueueItem): SerializedQueueItem {
  return {
    ...item,
    verifiedAt: item.verifiedAt?.toISOString() ?? null,
    rejectedAt: item.rejectedAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
    bills: item.bills.map((bill) => ({
      ...bill,
      vote: bill.vote ? { ...bill.vote, voteDate: bill.vote.voteDate?.toISOString() ?? null } : null,
    })),
  };
}

/** Recent reviewer activity, for the audit strip on the queue page. */
export async function fetchRecentReviews(limit = 15) {
  return prisma.markerAchievementReview.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      previousStatus: true,
      reviewerEmail: true,
      note: true,
      createdAt: true,
      achievement: {
        select: {
          id: true,
          legislator: { select: { fullName: true, state: true } },
          marker: { select: { name: true, plank: { select: { number: true } } } },
        },
      },
    },
  });
}
