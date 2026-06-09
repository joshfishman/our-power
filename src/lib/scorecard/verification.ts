// Phase 6 — admin verification data access.
//
// Everything the /admin/scorecard/verification page needs to list, count,
// and filter MarkerAchievement rows by verification state. Kept separate
// from queries.ts on purpose: queries.ts is the public-page read layer;
// this file is admin-only surface area.
//
// Trust-tier model (PR #50 spec, §4 — derived, never stored):
//   GREEN  — human-verified: verifiedAt set, verifiedBy is a real admin
//            identifier (not an engine value).
//   YELLOW — auto-verified: verifiedAt set by a script
//            ('auto-verify-temp' bulk flip, or 'pac-engine-*' at ingest).
//   RED    — unverified: verifiedAt is null.
//
// The review queue = RED ∪ the 'auto-verify-temp' slice of YELLOW.
// 'pac-engine-*' rows are excluded: they are computed directly from
// public FEC / Cal-Access filings by a deterministic engine and are
// considered self-verified (see computePacAchievements in
// scripts/compute-scores.ts).

import prisma from '@/lib/prisma/prisma';
import type { Prisma } from '@/generated/prisma/client';

/** verifiedBy value written by `compute-scores --auto-verify` (the Phase 6 stand-in). */
export const AUTO_VERIFY_TEMP = 'auto-verify-temp';

/**
 * verifiedBy prefix written by computePacAchievements (e.g. 'pac-engine-v1.4').
 * Prefix-matched so future engine version bumps stay excluded from the queue.
 */
export const PAC_ENGINE_PREFIX = 'pac-engine';

export type TrustTier = 'GREEN' | 'YELLOW' | 'RED';

export function trustTierFor(a: { verifiedAt: Date | null; verifiedBy: string | null }): TrustTier {
  if (!a.verifiedAt) return 'RED';
  if (a.verifiedBy === AUTO_VERIFY_TEMP || (a.verifiedBy ?? '').startsWith(PAC_ENGINE_PREFIX)) return 'YELLOW';
  return 'GREEN';
}

export interface VerificationFilters {
  jurisdiction?: 'FEDERAL' | 'CA';
  plankNumber?: number; // 1-5 federal, 1-4 CA
}

/**
 * Where-clause for rows that still need a human review. Shared by the queue
 * page and the bulk-verify server action so the "Bulk verify N rows" button
 * always operates on exactly the set the admin is looking at.
 */
export function needsReviewWhere(filters: VerificationFilters): Prisma.MarkerAchievementWhereInput {
  return {
    OR: [{ verifiedAt: null }, { verifiedBy: AUTO_VERIFY_TEMP }],
    // Belt-and-braces: pac-engine rows can never match the OR above today
    // (they always have verifiedAt set and a pac-engine verifiedBy), but an
    // explicit exclusion keeps the queue correct if a future ingest path
    // ever writes pac-engine rows unverified.
    NOT: { verifiedBy: { startsWith: PAC_ENGINE_PREFIX } },
    marker: {
      ...(filters.jurisdiction ? { jurisdiction: filters.jurisdiction } : {}),
      ...(filters.plankNumber ? { plank: { number: filters.plankNumber } } : {}),
    },
  };
}

export interface VerificationSummary {
  total: number;
  /** RED — verifiedAt null. */
  unverified: number;
  /** YELLOW — bulk-flipped by compute-scores --auto-verify. */
  autoVerifiedTemp: number;
  /** YELLOW (self-verified) — written by the PAC engine; excluded from the queue. */
  pacEngine: number;
  /** GREEN — verifiedAt set by a human admin (includes human rejections). */
  humanVerified: number;
  /** Rows currently matching the queue definition (no filters). */
  queueTotal: number;
}

export async function getVerificationSummary(): Promise<VerificationSummary> {
  const [total, unverified, autoVerifiedTemp, pacEngine, queueTotal] = await Promise.all([
    prisma.markerAchievement.count(),
    prisma.markerAchievement.count({ where: { verifiedAt: null } }),
    prisma.markerAchievement.count({ where: { verifiedBy: AUTO_VERIFY_TEMP } }),
    prisma.markerAchievement.count({ where: { verifiedBy: { startsWith: PAC_ENGINE_PREFIX } } }),
    prisma.markerAchievement.count({ where: needsReviewWhere({}) }),
  ]);
  // GREEN = everything verified that isn't an engine value. Computed by
  // subtraction so the four buckets always sum to `total`.
  const humanVerified = total - unverified - autoVerifiedTemp - pacEngine;
  return { total, unverified, autoVerifiedTemp, pacEngine, humanVerified, queueTotal };
}

export const QUEUE_PAGE_SIZE = 50;

export interface QueueItem {
  id: string;
  actionTaken: 'ACTED_FOR' | 'ACTED_AGAINST' | 'NO_RECORD' | null;
  evidenceType: string;
  evidenceSourceUrl: string | null;
  evidenceNotes: string | null;
  sponsorTier: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  trustTier: TrustTier;
  legislator: {
    id: string;
    fullName: string;
    party: string;
    state: string;
    chamber: string;
    jurisdiction: string;
    bioguideId: string | null;
    openStatesId: string | null;
  };
  marker: {
    name: string;
    markerType: string;
    plankNumber: number;
    plankName: string;
  };
}

export interface VerificationQueuePage {
  items: QueueItem[];
  /** Total rows matching the filter (for pagination). */
  matching: number;
  page: number; // 1-based
  pageCount: number;
}

export async function getVerificationQueue(filters: VerificationFilters, page: number): Promise<VerificationQueuePage> {
  const where = needsReviewWhere(filters);
  const matching = await prisma.markerAchievement.count({ where });
  const pageCount = Math.max(1, Math.ceil(matching / QUEUE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);

  const rows = await prisma.markerAchievement.findMany({
    where,
    orderBy: [
      // RED (never verified) first — highest priority per the spec — then
      // stable legislator/marker ordering so pagination doesn't shuffle.
      { verifiedAt: { sort: 'asc', nulls: 'first' } },
      { legislator: { fullName: 'asc' } },
      { marker: { displayOrder: 'asc' } },
      { id: 'asc' },
    ],
    skip: (safePage - 1) * QUEUE_PAGE_SIZE,
    take: QUEUE_PAGE_SIZE,
    select: {
      id: true,
      actionTaken: true,
      evidenceType: true,
      evidenceSourceUrl: true,
      evidenceNotes: true,
      sponsorTier: true,
      verifiedAt: true,
      verifiedBy: true,
      legislator: {
        select: {
          id: true,
          fullName: true,
          party: true,
          state: true,
          chamber: true,
          jurisdiction: true,
          bioguideId: true,
          openStatesId: true,
        },
      },
      marker: {
        select: {
          name: true,
          markerType: true,
          plank: { select: { number: true, name: true } },
        },
      },
    },
  });

  const items: QueueItem[] = rows.map((r) => ({
    id: r.id,
    actionTaken: r.actionTaken,
    evidenceType: r.evidenceType,
    evidenceSourceUrl: r.evidenceSourceUrl,
    evidenceNotes: r.evidenceNotes,
    sponsorTier: r.sponsorTier,
    verifiedAt: r.verifiedAt,
    verifiedBy: r.verifiedBy,
    trustTier: trustTierFor(r),
    legislator: r.legislator,
    marker: {
      name: r.marker.name,
      markerType: r.marker.markerType,
      plankNumber: r.marker.plank.number,
      plankName: r.marker.plank.name,
    },
  }));

  return { items, matching, page: safePage, pageCount };
}
