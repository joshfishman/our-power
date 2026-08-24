import { describe, it, expect } from 'vitest';
import {
  MAX_BULK_REVIEW,
  canReview,
  canRevoke,
  isActionAllowed,
  parseAdminAllowlist,
  planReview,
  resolveEffectivePlatformRole,
  trustTierFor,
  type PlatformRole,
  type ReviewableAchievement,
  type Reviewer,
} from '@/lib/scorecard/verification';
import { buildQueueOrderBy, buildQueueWhere, tierWhere } from '@/lib/scorecard/verification-filters';
import { reviewAchievementsSchema, verificationQueueQuerySchema } from '@/lib/validations/scorecard-verification';

const NOW = new Date('2026-08-24T12:00:00.000Z');

const reviewer = (role: PlatformRole = 'SCORECARD_VERIFIER'): Reviewer => ({
  userId: 'user_1',
  email: 'verifier@example.org',
  role,
});

const achievement = (overrides: Partial<ReviewableAchievement> = {}): ReviewableAchievement => ({
  id: 'ach_1',
  verifiedAt: null,
  verifierUserId: null,
  reviewStatus: 'PENDING',
  ...overrides,
});

describe('trust tier derivation', () => {
  it('treats a never-touched achievement as RED', () => {
    expect(trustTierFor({ verifiedAt: null, verifierUserId: null, reviewStatus: 'PENDING' })).toBe('RED');
  });

  it('treats a machine-verified achievement as YELLOW, not GREEN', () => {
    expect(trustTierFor({ verifiedAt: NOW, verifierUserId: null, reviewStatus: 'PENDING' })).toBe('YELLOW');
  });

  it('treats a human-verified achievement as GREEN', () => {
    expect(trustTierFor({ verifiedAt: NOW, verifierUserId: 'user_1', reviewStatus: 'VERIFIED' })).toBe('GREEN');
  });

  it('reports REJECTED regardless of any stale verification stamp', () => {
    expect(trustTierFor({ verifiedAt: NOW, verifierUserId: 'user_1', reviewStatus: 'REJECTED' })).toBe('REJECTED');
  });
});

describe('authorization', () => {
  it('denies plain members any review action', () => {
    expect(canReview('MEMBER')).toBe(false);
    expect(canRevoke('MEMBER')).toBe(false);
    expect(isActionAllowed('MEMBER', 'VERIFY')).toBe(false);
    expect(isActionAllowed('MEMBER', 'REJECT')).toBe(false);
    expect(isActionAllowed('MEMBER', 'REVOKE')).toBe(false);
  });

  it('lets a verifier verify and reject but not revoke', () => {
    expect(isActionAllowed('SCORECARD_VERIFIER', 'VERIFY')).toBe(true);
    expect(isActionAllowed('SCORECARD_VERIFIER', 'REJECT')).toBe(true);
    expect(isActionAllowed('SCORECARD_VERIFIER', 'REVOKE')).toBe(false);
  });

  it('lets an admin do everything', () => {
    expect(isActionAllowed('SCORECARD_ADMIN', 'VERIFY')).toBe(true);
    expect(isActionAllowed('SCORECARD_ADMIN', 'REJECT')).toBe(true);
    expect(isActionAllowed('SCORECARD_ADMIN', 'REVOKE')).toBe(true);
  });

  it('parses and normalizes the env allowlist', () => {
    expect(parseAdminAllowlist(' A@Example.org , b@example.org ,, ')).toEqual(['a@example.org', 'b@example.org']);
    expect(parseAdminAllowlist(undefined)).toEqual([]);
    expect(parseAdminAllowlist('')).toEqual([]);
  });

  it('promotes an allowlisted email to admin', () => {
    const role = resolveEffectivePlatformRole({
      storedRole: 'MEMBER',
      email: 'Lead@Example.org',
      allowlistRaw: 'lead@example.org',
    });
    expect(role).toBe('SCORECARD_ADMIN');
  });

  it('leaves a non-allowlisted user on their stored role', () => {
    expect(
      resolveEffectivePlatformRole({
        storedRole: 'SCORECARD_VERIFIER',
        email: 'someone@example.org',
        allowlistRaw: 'lead@example.org',
      }),
    ).toBe('SCORECARD_VERIFIER');
  });

  it('never grants authority to an anonymous request', () => {
    expect(resolveEffectivePlatformRole({ storedRole: null, email: null, allowlistRaw: 'lead@example.org' })).toBe(
      'MEMBER',
    );
    expect(resolveEffectivePlatformRole({ storedRole: undefined, email: '', allowlistRaw: '*' })).toBe('MEMBER');
  });

  it('does not downgrade a stored admin who is absent from the allowlist', () => {
    expect(
      resolveEffectivePlatformRole({
        storedRole: 'SCORECARD_ADMIN',
        email: 'admin@example.org',
        allowlistRaw: '',
      }),
    ).toBe('SCORECARD_ADMIN');
  });
});

describe('verify transition', () => {
  it('stamps the reviewer’s real identity, never a placeholder', () => {
    const plan = planReview(achievement(), reviewer(), {
      action: 'VERIFY',
      citationUrl: 'https://congress.gov/rollcall/123',
      now: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.update.verifiedBy).toBe('verifier@example.org');
    expect(plan.update.verifiedBy).not.toBe('auto-verify-temp');
    expect(plan.update.verifierUserId).toBe('user_1');
    expect(plan.update.verifiedAt).toEqual(NOW);
    expect(plan.update.reviewStatus).toBe('VERIFIED');
    expect(plan.update.verifiedFromUrl).toBe('https://congress.gov/rollcall/123');
  });

  it('promotes a machine-verified row from YELLOW to GREEN', () => {
    const plan = planReview(achievement({ verifiedAt: NOW, verifierUserId: null }), reviewer(), {
      action: 'VERIFY',
      citationUrl: 'https://fec.gov/filing',
      now: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(
      trustTierFor({
        verifiedAt: plan.update.verifiedAt,
        verifierUserId: plan.update.verifierUserId,
        reviewStatus: plan.update.reviewStatus,
      }),
    ).toBe('GREEN');
  });

  it('refuses to verify without a citation URL', () => {
    const plan = planReview(achievement(), reviewer(), { action: 'VERIFY', citationUrl: '   ', now: NOW });
    expect(plan).toEqual({ ok: false, reason: 'A citation URL is required to verify' });
  });

  it('refuses to re-verify an already human-verified row', () => {
    const plan = planReview(
      achievement({ verifiedAt: NOW, verifierUserId: 'user_2', reviewStatus: 'VERIFIED' }),
      reviewer(),
      { action: 'VERIFY', citationUrl: 'https://example.org', now: NOW },
    );
    expect(plan).toEqual({ ok: false, reason: 'Already human-verified' });
  });

  it('refuses to verify for a plain member', () => {
    const plan = planReview(achievement(), reviewer('MEMBER'), {
      action: 'VERIFY',
      citationUrl: 'https://example.org',
      now: NOW,
    });
    expect(plan.ok).toBe(false);
  });

  it('clears a prior rejection when a verifier later approves', () => {
    const plan = planReview(achievement({ reviewStatus: 'REJECTED' }), reviewer(), {
      action: 'VERIFY',
      citationUrl: 'https://example.org',
      now: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.update.rejectedAt).toBeNull();
    expect(plan.update.reviewStatus).toBe('VERIFIED');
  });
});

describe('reject transition', () => {
  it('drops the row out of scoring and out of the pending queue', () => {
    const plan = planReview(achievement({ verifiedAt: NOW, verifierUserId: null }), reviewer(), {
      action: 'REJECT',
      note: 'Roll call was a motion to recommit, not the underlying bill',
      now: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // verifiedAt null keeps it out of compute-scores…
    expect(plan.update.verifiedAt).toBeNull();
    // …and REJECTED keeps it from silently re-queueing forever.
    expect(plan.update.reviewStatus).toBe('REJECTED');
    expect(plan.update.rejectedAt).toEqual(NOW);
    expect(
      trustTierFor({
        verifiedAt: plan.update.verifiedAt,
        verifierUserId: plan.update.verifierUserId,
        reviewStatus: plan.update.reviewStatus,
      }),
    ).toBe('REJECTED');
  });

  it('requires a written reason', () => {
    const plan = planReview(achievement(), reviewer(), { action: 'REJECT', note: '  ', now: NOW });
    expect(plan).toEqual({ ok: false, reason: 'A reason is required to reject' });
  });

  it('refuses to reject twice', () => {
    const plan = planReview(achievement({ reviewStatus: 'REJECTED' }), reviewer(), {
      action: 'REJECT',
      note: 'again',
      now: NOW,
    });
    expect(plan).toEqual({ ok: false, reason: 'Already rejected' });
  });

  it('records an audit entry naming the reviewer and the prior status', () => {
    const plan = planReview(achievement({ verifiedAt: NOW, reviewStatus: 'PENDING' }), reviewer(), {
      action: 'REJECT',
      note: 'source does not support the claim',
      now: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.audit).toMatchObject({
      achievementId: 'ach_1',
      reviewerUserId: 'user_1',
      reviewerEmail: 'verifier@example.org',
      action: 'REJECT',
      previousStatus: 'PENDING',
      note: 'source does not support the claim',
    });
  });
});

describe('revoke transition', () => {
  const verified = achievement({ verifiedAt: NOW, verifierUserId: 'user_2', reviewStatus: 'VERIFIED' });

  it('returns a verified row to PENDING for an admin', () => {
    const plan = planReview(verified, reviewer('SCORECARD_ADMIN'), {
      action: 'REVOKE',
      note: 'citation did not match',
      now: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.update.reviewStatus).toBe('PENDING');
    expect(plan.update.verifiedAt).toBeNull();
    expect(plan.update.verifierUserId).toBeNull();
    expect(plan.update.verifiedBy).toBeNull();
    expect(
      trustTierFor({
        verifiedAt: plan.update.verifiedAt,
        verifierUserId: plan.update.verifierUserId,
        reviewStatus: plan.update.reviewStatus,
      }),
    ).toBe('RED');
  });

  it('denies revoke to a verifier', () => {
    const plan = planReview(verified, reviewer('SCORECARD_VERIFIER'), {
      action: 'REVOKE',
      note: 'nope',
      now: NOW,
    });
    expect(plan).toEqual({ ok: false, reason: 'Role SCORECARD_VERIFIER may not perform REVOKE' });
  });

  it('refuses to revoke something that was never verified', () => {
    const plan = planReview(achievement(), reviewer('SCORECARD_ADMIN'), {
      action: 'REVOKE',
      note: 'nope',
      now: NOW,
    });
    expect(plan).toEqual({ ok: false, reason: 'Only a verified achievement can be revoked' });
  });
});

describe('request validation', () => {
  const base = { achievementIds: ['a1'], action: 'VERIFY' as const, citationUrl: 'https://example.org/vote' };

  it('accepts a well-formed single verify', () => {
    expect(reviewAchievementsSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a verify with no citation URL', () => {
    const result = reviewAchievementsSchema.safeParse({ achievementIds: ['a1'], action: 'VERIFY' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-http citation URL', () => {
    // eslint-disable-next-line no-script-url
    const hostileUrl = 'javascript:alert(1)';
    const result = reviewAchievementsSchema.safeParse({ ...base, citationUrl: hostileUrl });
    expect(result.success).toBe(false);
  });

  it('rejects a reject with no note', () => {
    const result = reviewAchievementsSchema.safeParse({ achievementIds: ['a1'], action: 'REJECT' });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate ids', () => {
    const result = reviewAchievementsSchema.safeParse({ ...base, achievementIds: ['a1', 'a1'] });
    expect(result.success).toBe(false);
  });

  it('requires an exact count confirmation for bulk actions', () => {
    const unarmed = reviewAchievementsSchema.safeParse({
      ...base,
      achievementIds: ['a1', 'a2', 'a3'],
      note: 'same roll call, three cosponsors',
    });
    expect(unarmed.success).toBe(false);

    const wrongCount = reviewAchievementsSchema.safeParse({
      ...base,
      achievementIds: ['a1', 'a2', 'a3'],
      note: 'same roll call, three cosponsors',
      bulkConfirmation: 2,
    });
    expect(wrongCount.success).toBe(false);

    const armed = reviewAchievementsSchema.safeParse({
      ...base,
      achievementIds: ['a1', 'a2', 'a3'],
      note: 'same roll call, three cosponsors',
      bulkConfirmation: 3,
    });
    expect(armed.success).toBe(true);
  });

  it('requires a note on every bulk action, even a verify', () => {
    const result = reviewAchievementsSchema.safeParse({
      ...base,
      achievementIds: ['a1', 'a2'],
      bulkConfirmation: 2,
    });
    expect(result.success).toBe(false);
  });

  it('caps the size of a bulk action', () => {
    const ids = Array.from({ length: MAX_BULK_REVIEW + 1 }, (_, index) => `a${index}`);
    const result = reviewAchievementsSchema.safeParse({
      ...base,
      achievementIds: ids,
      note: 'too many',
      bulkConfirmation: ids.length,
    });
    expect(result.success).toBe(false);
  });

  it('defaults the queue to the unverified tier, oldest first', () => {
    const query = verificationQueueQuerySchema.parse({});
    expect(query.tier).toBe('RED');
    expect(query.sort).toBe('oldest');
    expect(query.limit).toBe(50);
    expect(query.offset).toBe(0);
  });

  it('rejects an out-of-range plank', () => {
    expect(verificationQueueQuerySchema.safeParse({ plank: 9 }).success).toBe(false);
  });
});

describe('queue predicates', () => {
  it('keeps the tier predicates in step with trustTierFor', () => {
    expect(tierWhere('RED')).toEqual({ verifiedAt: null, reviewStatus: { not: 'REJECTED' } });
    expect(tierWhere('YELLOW')).toEqual({
      verifiedAt: { not: null },
      verifierUserId: null,
      reviewStatus: { not: 'REJECTED' },
    });
    expect(tierWhere('GREEN')).toEqual({ verifiedAt: { not: null }, verifierUserId: { not: null } });
    expect(tierWhere('REJECTED')).toEqual({ reviewStatus: 'REJECTED' });
    expect(tierWhere('ALL')).toEqual({});
  });

  it('composes jurisdiction, plank, and marker-type filters onto the marker relation', () => {
    const where = buildQueueWhere(
      verificationQueueQuerySchema.parse({ tier: 'RED', jurisdiction: 'CA', plank: 3, markerType: 'PRIMARY' }),
    );
    expect(where).toEqual({
      verifiedAt: null,
      reviewStatus: { not: 'REJECTED' },
      marker: { jurisdiction: 'CA', markerType: 'PRIMARY', plank: { number: 3 } },
    });
  });

  it('narrows by legislator and by single achievement', () => {
    const where = buildQueueWhere(
      verificationQueueQuerySchema.parse({ tier: 'ALL', legislatorId: 'leg_1', achievementId: 'ach_9' }),
    );
    expect(where).toEqual({ id: 'ach_9', legislatorId: 'leg_1' });
  });

  it('maps every sort option to a stable ordering', () => {
    expect(buildQueueOrderBy('oldest')).toEqual([{ updatedAt: 'asc' }]);
    expect(buildQueueOrderBy('newest')).toEqual([{ updatedAt: 'desc' }]);
    expect(buildQueueOrderBy('legislator')).toEqual([
      { legislator: { lastName: 'asc' } },
      { legislator: { firstName: 'asc' } },
    ]);
    expect(buildQueueOrderBy('plank')).toEqual([
      { marker: { plank: { number: 'asc' } } },
      { marker: { displayOrder: 'asc' } },
    ]);
  });
});
