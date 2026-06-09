'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma/prisma';
import { isScorecardAdmin } from '@/lib/scorecard/admin-auth';
import { needsReviewWhere, type VerificationFilters } from '@/lib/scorecard/verification';

const PAGE = '/admin/scorecard/verification';

export interface ActionResult {
  ok: boolean;
  error?: string;
  count?: number;
}

/**
 * Human sign-off on one achievement: the admin opened the evidence source
 * and confirmed the row is right. Sets verifiedAt=now / verifiedBy=admin
 * email — which moves the row to the GREEN trust tier (see
 * src/lib/scorecard/verification.ts) and out of the queue.
 */
export async function verifyAchievement(formData: FormData): Promise<ActionResult> {
  const { allowed, email } = await isScorecardAdmin();
  if (!allowed) return { ok: false, error: 'Not authorized' };

  const id = String(formData.get('achievementId') ?? '');
  if (!id) return { ok: false, error: 'Missing achievementId' };

  try {
    await prisma.markerAchievement.update({
      where: { id },
      data: { verifiedAt: new Date(), verifiedBy: email ?? 'unknown-admin' },
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Reject: the admin reviewed the evidence and it does NOT support the
 * recorded position.
 *
 * REJECT SEMANTICS — update to NO_RECORD, do not delete. Why:
 *
 * 1. How the rest of the system treats the row after this write:
 *    - compute-scores.ts (v1.7.1) derives voting tallies from the
 *      RollCallVote alignment universe, NOT from MarkerAchievement, so a
 *      rejected row never feeds a voting percentage either way. The PAC
 *      score reads PacMoneyData directly (and pac-engine rows are excluded
 *      from this queue entirely).
 *    - Display + coverage (queries.ts computePlankCoverage / the public
 *      legislator page) count only ACTED_FOR / ACTED_AGAINST rows.
 *      NO_RECORD is explicitly "we have no valid public record" and drops
 *      out of measured-marker tallies — exactly what a rejection means.
 *    - achieved=false keeps the legacy back-compat flag consistent.
 *
 * 2. Why not delete: the schema treats row-absence as implicit NO_RECORD,
 *    so deletion would also work for scoring — but (a) the next ingest run
 *    would simply upsert the same row back as unverified, re-creating queue
 *    churn with no trace that a human already looked at it, and (b) the
 *    rejection reason stamped into evidenceNotes is the only audit trail we
 *    have without a schema change (PR #50's rejectionReason column is a
 *    future migration; this feature is new-files-only).
 *
 * verifiedAt/verifiedBy are SET (not cleared): a rejection is itself a
 * completed human review, so the row leaves the queue and counts toward
 * the human-verified total.
 */
export async function rejectAchievement(formData: FormData): Promise<ActionResult> {
  const { allowed, email } = await isScorecardAdmin();
  if (!allowed) return { ok: false, error: 'Not authorized' };

  const id = String(formData.get('achievementId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!id) return { ok: false, error: 'Missing achievementId' };
  if (!reason) return { ok: false, error: 'A rejection reason is required' };

  try {
    const existing = await prisma.markerAchievement.findUnique({
      where: { id },
      select: { evidenceNotes: true },
    });
    if (!existing) return { ok: false, error: 'Achievement not found' };

    const stamp = `[REJECTED ${new Date().toISOString().slice(0, 10)} by ${email ?? 'unknown-admin'}] ${reason}`;
    await prisma.markerAchievement.update({
      where: { id },
      data: {
        actionTaken: 'NO_RECORD',
        achieved: false,
        verifiedAt: new Date(),
        verifiedBy: email ?? 'unknown-admin',
        evidenceNotes: existing.evidenceNotes ? `${stamp}\n${existing.evidenceNotes}` : stamp,
      },
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Bulk verify every row matching the CURRENT filter (jurisdiction + plank).
 * Uses the same needsReviewWhere() the queue page renders from, so the set
 * verified is exactly the set the admin is looking at — never pac-engine
 * rows, never already-human-verified rows.
 *
 * verifiedBy is prefixed 'bulk:' so a bulk pass stays distinguishable from
 * per-row review in any later audit (the trust-tier helper still classifies
 * it GREEN — a named human pressed the button and owns the call).
 */
export async function bulkVerifyFiltered(formData: FormData): Promise<ActionResult> {
  const { allowed, email } = await isScorecardAdmin();
  if (!allowed) return { ok: false, error: 'Not authorized' };

  const jurisdictionRaw = String(formData.get('jurisdiction') ?? '');
  const plankRaw = String(formData.get('plankNumber') ?? '');
  const filters: VerificationFilters = {
    ...(jurisdictionRaw === 'FEDERAL' || jurisdictionRaw === 'CA' ? { jurisdiction: jurisdictionRaw } : {}),
    ...(/^[1-5]$/.test(plankRaw) ? { plankNumber: parseInt(plankRaw, 10) } : {}),
  };

  try {
    const result = await prisma.markerAchievement.updateMany({
      where: needsReviewWhere(filters),
      data: { verifiedAt: new Date(), verifiedBy: `bulk:${email ?? 'unknown-admin'}` },
    });
    revalidatePath(PAGE);
    return { ok: true, count: result.count };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
