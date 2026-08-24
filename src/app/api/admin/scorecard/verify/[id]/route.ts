// GET /api/admin/scorecard/verify/[id]
//
// Full evidence dossier for one achievement plus its complete review history.
// Same-origin and admin-gated for the same reason as the collection route.

import { z } from 'zod';
import { apiError, enforceRateLimit, requestId } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import prisma from '@/lib/prisma/prisma';
import { requireReviewer } from '@/lib/scorecard/verification-auth';
import { fetchVerificationQueue } from '@/lib/scorecard/verification-queue';
import { verificationQueueQuerySchema } from '@/lib/validations/scorecard-verification';

export const dynamic = 'force-dynamic';

const idSchema = z.string().min(1).max(64);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reqId = requestId();
  try {
    const rateLimited = await enforceRateLimit(request, { limit: 120, windowSeconds: 60 });
    if (rateLimited) return rateLimited;

    const reviewer = await requireReviewer();
    if (!reviewer) return apiError('Not authorized', 403, reqId);

    const parsedId = idSchema.safeParse((await params).id);
    if (!parsedId.success) return apiError('Invalid achievement id', 400, reqId);

    // Reuse the queue loader so the single-item payload and the queue rows are
    // assembled by exactly one code path.
    const query = verificationQueueQuerySchema.parse({
      tier: 'ALL',
      limit: 1,
      achievementId: parsedId.data,
    });

    const [queue, history] = await Promise.all([
      fetchVerificationQueue(query),
      prisma.markerAchievementReview.findMany({
        where: { achievementId: parsedId.data },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          previousStatus: true,
          reviewerEmail: true,
          citationUrl: true,
          note: true,
          createdAt: true,
        },
      }),
    ]);

    const achievement = queue.items[0];
    if (!achievement) return apiError('Achievement not found', 404, reqId);

    return Response.json({ achievement, history }, { headers: { 'X-Request-Id': reqId, 'Cache-Control': 'no-store' } });
  } catch (error) {
    logError('Error loading scorecard achievement evidence', error);
    return apiError('Failed to load achievement', 500, reqId);
  }
}
