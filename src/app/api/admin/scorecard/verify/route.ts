// Phase 6 verification API.
//
// GET  /api/admin/scorecard/verify   — the review queue as JSON
// POST /api/admin/scorecard/verify   — verify / reject / revoke one or many rows
//
// Deliberately NOT CORS-enabled. Every other scorecard endpoint is a public,
// read-only surface and calls withCors(); this one mutates the evidence behind
// published scores, so it stays same-origin.
//
// Authorization is enforced here, server-side, on every request. The admin page
// also hides the controls, but that is cosmetics — this is the gate.

import { apiError, enforceRateLimit, requestId } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import prisma from '@/lib/prisma/prisma';
import { canRevoke, requireReviewer } from '@/lib/scorecard/verification-auth';
import { fetchVerificationQueue } from '@/lib/scorecard/verification-queue';
import { planReview, type ReviewStatus } from '@/lib/scorecard/verification';
import { reviewAchievementsSchema, verificationQueueQuerySchema } from '@/lib/validations/scorecard-verification';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const reqId = requestId();
  try {
    const rateLimited = await enforceRateLimit(request, { limit: 120, windowSeconds: 60 });
    if (rateLimited) return rateLimited;

    const reviewer = await requireReviewer();
    if (!reviewer) return apiError('Not authorized', 403, reqId);

    const { searchParams } = new URL(request.url);
    const parsed = verificationQueueQuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Invalid query', 400, reqId);
    }

    const queue = await fetchVerificationQueue(parsed.data);
    return Response.json(
      { ...queue, reviewer: { email: reviewer.email, role: reviewer.role } },
      { headers: { 'X-Request-Id': reqId, 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logError('Error loading scorecard verification queue', error);
    return apiError('Failed to load verification queue', 500, reqId);
  }
}

export async function POST(request: Request) {
  const reqId = requestId();
  try {
    const rateLimited = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
    if (rateLimited) return rateLimited;

    const reviewer = await requireReviewer();
    if (!reviewer) return apiError('Not authorized', 403, reqId);

    const body = await request.json().catch(() => null);
    const parsed = reviewAchievementsSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Invalid request', 400, reqId);
    }
    const input = parsed.data;

    // Role check for the privileged action happens before any DB work so an
    // unauthorized revoke never even reads the rows.
    if (input.action === 'REVOKE' && !canRevoke(reviewer.role)) {
      return apiError('Only a scorecard admin may revoke a verification', 403, reqId);
    }

    const achievements = await prisma.markerAchievement.findMany({
      where: { id: { in: input.achievementIds } },
      select: { id: true, verifiedAt: true, verifierUserId: true, reviewStatus: true },
    });

    const found = new Set(achievements.map((a) => a.id));
    const missing = input.achievementIds.filter((id) => !found.has(id));

    const applied: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = missing.map((id) => ({
      id,
      reason: 'Achievement not found',
    }));

    const now = new Date();
    const writes = [];

    for (const achievement of achievements) {
      const plan = planReview({ ...achievement, reviewStatus: achievement.reviewStatus as ReviewStatus }, reviewer, {
        action: input.action,
        citationUrl: input.citationUrl,
        note: input.note,
        now,
      });

      if (!plan.ok) {
        skipped.push({ id: achievement.id, reason: plan.reason });
        continue;
      }

      applied.push(achievement.id);
      writes.push(
        prisma.markerAchievement.update({ where: { id: achievement.id }, data: plan.update }),
        prisma.markerAchievementReview.create({ data: plan.audit }),
      );
    }

    if (writes.length > 0) {
      // One transaction: the achievement row and its audit entry are the same
      // fact recorded twice. A half-written pair would be a hole in the trail.
      await prisma.$transaction(writes);
    }

    return Response.json(
      { action: input.action, appliedCount: applied.length, applied, skipped },
      { headers: { 'X-Request-Id': reqId, 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logError('Error recording scorecard verification', error);
    return apiError('Failed to record verification', 500, reqId);
  }
}
