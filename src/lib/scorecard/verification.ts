// Phase 6 — human verification of scorecard evidence.
//
// Pure logic only: no Prisma client, no `next/*`, no `@/auth`. Everything here
// is a total function over plain data so the authorization rules and the
// verify / reject / revoke state transitions are unit-testable without a
// database or a session.
//
// Why this module exists at all: the published methodology promises that
// "every score is reviewed by a human before it goes public." Until now the
// only mechanism was `scripts/compute-scores.ts --auto-verify`, which stamps
// `verifiedBy = 'auto-verify-temp'`. That is a placeholder, not a reviewer.

/** Provenance label written by the temporary bulk-verify stand-in. */
export const AUTO_VERIFY_PLACEHOLDER = 'auto-verify-temp';

/**
 * Prefix for provenance labels written by the PAC engine.
 *
 * These are NOT placeholders in the same sense as the one above. FEC and
 * Cal-Access filings are already public, machine-readable primary documents;
 * a corporate-PAC-refusal achievement derived from them is reproducible from
 * the filing itself, so the engine legitimately auto-verifies at write time.
 * They still surface as YELLOW (machine-verified) rather than GREEN, because
 * "reproducible from a filing" is a weaker claim than "a named human opened
 * the filing and agreed." A verifier may promote them; nothing forces it.
 */
export const PAC_ENGINE_PREFIX = 'pac-engine';

/** Largest number of achievements one bulk action may touch. */
export const MAX_BULK_REVIEW = 100;

export type PlatformRole = 'MEMBER' | 'SCORECARD_VERIFIER' | 'SCORECARD_ADMIN';
export type ReviewStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type ReviewAction = 'VERIFY' | 'REJECT' | 'REVOKE';

/**
 * Trust tier, derived rather than stored — a stored copy would drift from the
 * fields it summarises.
 *
 *   GREEN  a signed-in human verified it
 *   YELLOW a machine verified it (auto-verify stand-in, or the PAC engine)
 *   RED    nothing has verified it; it does not count toward any score
 *   REJECTED a human looked and said no; it does not count and does not re-queue
 */
export type TrustTier = 'GREEN' | 'YELLOW' | 'RED' | 'REJECTED';

/** The subset of MarkerAchievement the tier derivation reads. */
export interface TrustTierInput {
  verifiedAt: Date | null;
  verifierUserId: string | null;
  reviewStatus: ReviewStatus;
}

export function trustTierFor(achievement: TrustTierInput): TrustTier {
  if (achievement.reviewStatus === 'REJECTED') return 'REJECTED';
  if (achievement.verifiedAt === null) return 'RED';
  return achievement.verifierUserId !== null ? 'GREEN' : 'YELLOW';
}

/** Human-readable label for a tier, for UI and API payloads. */
export const TRUST_TIER_LABEL: Record<TrustTier, string> = {
  GREEN: 'Human-verified',
  YELLOW: 'Machine-verified — awaiting human review',
  RED: 'Unverified',
  REJECTED: 'Rejected',
};

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<PlatformRole, number> = {
  MEMBER: 0,
  SCORECARD_VERIFIER: 1,
  SCORECARD_ADMIN: 2,
};

/** May review (verify / reject) achievements in the queue. */
export function canReview(role: PlatformRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.SCORECARD_VERIFIER;
}

/** May withdraw somebody else's verification. Admin only. */
export function canRevoke(role: PlatformRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.SCORECARD_ADMIN;
}

export function isActionAllowed(role: PlatformRole, action: ReviewAction): boolean {
  return action === 'REVOKE' ? canRevoke(role) : canReview(role);
}

/** Parse the `SCORECARD_ADMIN_EMAILS` allowlist into normalized entries. */
export function parseAdminAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Effective platform role for a request.
 *
 * Two sources, whichever is stronger wins:
 *
 *  1. `User.platformRole` — the durable grant, assignable without a redeploy.
 *  2. `SCORECARD_ADMIN_EMAILS` — the pre-existing env allowlist. Kept as a
 *     bootstrap path so the first admin can grant roles to everyone else, and
 *     so an operator is never locked out of their own queue by a bad DB write.
 *
 * An unauthenticated request has no email and no stored role, and therefore
 * resolves to MEMBER — never to an admin.
 */
export function resolveEffectivePlatformRole(input: {
  storedRole: PlatformRole | null | undefined;
  email: string | null | undefined;
  allowlistRaw: string | null | undefined;
}): PlatformRole {
  const stored: PlatformRole = input.storedRole ?? 'MEMBER';
  const email = input.email?.trim().toLowerCase();
  if (!email) return stored;
  const allowlist = parseAdminAllowlist(input.allowlistRaw);
  const allowlisted = allowlist.includes(email);
  if (!allowlisted) return stored;
  return ROLE_RANK[stored] >= ROLE_RANK.SCORECARD_ADMIN ? stored : 'SCORECARD_ADMIN';
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/** The subset of MarkerAchievement a transition reads. */
export interface ReviewableAchievement {
  id: string;
  verifiedAt: Date | null;
  verifierUserId: string | null;
  reviewStatus: ReviewStatus;
}

export interface Reviewer {
  userId: string;
  email: string;
  role: PlatformRole;
}

/** Fields to write onto MarkerAchievement. */
export interface AchievementUpdate {
  reviewStatus: ReviewStatus;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  verifierUserId: string | null;
  verifiedFromUrl: string | null;
  reviewNote: string | null;
  rejectedAt: Date | null;
}

/** Row to append to MarkerAchievementReview. */
export interface AuditEntry {
  achievementId: string;
  reviewerUserId: string;
  reviewerEmail: string;
  action: ReviewAction;
  previousStatus: ReviewStatus;
  citationUrl: string | null;
  note: string | null;
}

export type ReviewPlan = { ok: true; update: AchievementUpdate; audit: AuditEntry } | { ok: false; reason: string };

export interface ReviewCommand {
  action: ReviewAction;
  /** Citation URL the verifier states they opened. Required on VERIFY. */
  citationUrl?: string | null;
  /** Reviewer note. Required on REJECT and REVOKE. */
  note?: string | null;
  /** Injected so transitions stay deterministic under test. */
  now?: Date;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

/**
 * Build the write for one reviewer action, or explain why it is not allowed.
 *
 * Deliberately total and side-effect free: the API route validates the request
 * shape with Zod, resolves the reviewer, then calls this once per achievement
 * and persists whatever comes back. All the judgement lives here.
 */
export function planReview(achievement: ReviewableAchievement, reviewer: Reviewer, command: ReviewCommand): ReviewPlan {
  const now = command.now ?? new Date();
  const note = normalizeText(command.note);
  const citationUrl = normalizeText(command.citationUrl);

  if (!isActionAllowed(reviewer.role, command.action)) {
    return { ok: false, reason: `Role ${reviewer.role} may not perform ${command.action}` };
  }

  const previousStatus = achievement.reviewStatus;
  const audit = (action: ReviewAction): AuditEntry => ({
    achievementId: achievement.id,
    reviewerUserId: reviewer.userId,
    reviewerEmail: reviewer.email,
    action,
    previousStatus,
    citationUrl,
    note,
  });

  switch (command.action) {
    case 'VERIFY': {
      if (previousStatus === 'VERIFIED' && achievement.verifierUserId !== null) {
        return { ok: false, reason: 'Already human-verified' };
      }
      if (!citationUrl) {
        return { ok: false, reason: 'A citation URL is required to verify' };
      }
      return {
        ok: true,
        update: {
          reviewStatus: 'VERIFIED',
          verifiedAt: now,
          // The reviewer's real identity — never a placeholder label.
          verifiedBy: reviewer.email,
          verifierUserId: reviewer.userId,
          verifiedFromUrl: citationUrl,
          reviewNote: note,
          rejectedAt: null,
        },
        audit: audit('VERIFY'),
      };
    }

    case 'REJECT': {
      if (previousStatus === 'REJECTED') {
        return { ok: false, reason: 'Already rejected' };
      }
      if (!note) {
        return { ok: false, reason: 'A reason is required to reject' };
      }
      return {
        ok: true,
        update: {
          reviewStatus: 'REJECTED',
          // Clearing verifiedAt drops the row out of scoring. REJECTED status
          // is what keeps it from re-entering the pending queue.
          verifiedAt: null,
          verifiedBy: reviewer.email,
          verifierUserId: null,
          verifiedFromUrl: null,
          reviewNote: note,
          rejectedAt: now,
        },
        audit: audit('REJECT'),
      };
    }

    case 'REVOKE': {
      if (previousStatus !== 'VERIFIED') {
        return { ok: false, reason: 'Only a verified achievement can be revoked' };
      }
      if (!note) {
        return { ok: false, reason: 'A reason is required to revoke' };
      }
      return {
        ok: true,
        update: {
          reviewStatus: 'PENDING',
          verifiedAt: null,
          verifiedBy: null,
          verifierUserId: null,
          verifiedFromUrl: null,
          reviewNote: note,
          rejectedAt: null,
        },
        audit: audit('REVOKE'),
      };
    }

    default:
      return { ok: false, reason: `Unknown action ${String(command.action)}` };
  }
}
