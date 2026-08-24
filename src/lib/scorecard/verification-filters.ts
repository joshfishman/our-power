// Pure filter/ordering logic for the Phase 6 verification queue.
//
// Split out from ./verification-queue so the predicates can be unit-tested
// without importing the Prisma client (which needs DATABASE_URL at import
// time). Type-only Prisma imports are erased at build.

import type { Prisma } from '@/generated/prisma/client';
import type { VerificationQueueQuery } from '@/lib/validations/scorecard-verification';
import type { TrustTier } from './verification';

export type QueueTier = TrustTier | 'ALL';

/**
 * Prisma predicate for each trust tier. These mirror `trustTierFor` exactly —
 * if one changes, the other must.
 */
export function tierWhere(tier: QueueTier): Prisma.MarkerAchievementWhereInput {
  switch (tier) {
    case 'RED':
      return { verifiedAt: null, reviewStatus: { not: 'REJECTED' } };
    case 'YELLOW':
      return { verifiedAt: { not: null }, verifierUserId: null, reviewStatus: { not: 'REJECTED' } };
    case 'GREEN':
      return { verifiedAt: { not: null }, verifierUserId: { not: null } };
    case 'REJECTED':
      return { reviewStatus: 'REJECTED' };
    case 'ALL':
    default:
      return {};
  }
}

export function buildQueueWhere(query: VerificationQueueQuery): Prisma.MarkerAchievementWhereInput {
  const markerFilter: Prisma.MarkerWhereInput = {};
  if (query.jurisdiction) markerFilter.jurisdiction = query.jurisdiction;
  if (query.markerType) markerFilter.markerType = query.markerType;
  if (query.plank !== undefined) markerFilter.plank = { number: query.plank };

  return {
    ...tierWhere(query.tier),
    ...(query.achievementId ? { id: query.achievementId } : {}),
    ...(query.legislatorId ? { legislatorId: query.legislatorId } : {}),
    ...(Object.keys(markerFilter).length > 0 ? { marker: markerFilter } : {}),
  };
}

export function buildQueueOrderBy(
  sort: VerificationQueueQuery['sort'],
): Prisma.MarkerAchievementOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ updatedAt: 'desc' }];
    case 'legislator':
      return [{ legislator: { lastName: 'asc' } }, { legislator: { firstName: 'asc' } }];
    case 'plank':
      return [{ marker: { plank: { number: 'asc' } } }, { marker: { displayOrder: 'asc' } }];
    case 'oldest':
    default:
      return [{ updatedAt: 'asc' }];
  }
}
