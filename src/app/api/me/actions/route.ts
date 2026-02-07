import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';

// GET /api/me/actions - Get current user's upcoming actions
export async function GET(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const includeCompleted = searchParams.get('completed') === 'true';

    // Get user's campaigns
    const memberships = await prisma.campaignMember.findMany({
      where: { userId: session.user.id },
      select: { campaignId: true },
    });

    const campaignIds = memberships.map((m) => m.campaignId);

    if (campaignIds.length === 0) {
      return NextResponse.json([]);
    }

    // Get actions from user's campaigns
    const actions = await prisma.action.findMany({
      where: {
        campaignId: { in: campaignIds },
        isActive: true,
        ...(includeCompleted ? {} : { dueDate: { gte: new Date() } }),
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            cause: { select: { name: true, icon: true, color: true } },
          },
        },
        _count: { select: { participants: true } },
        participants: {
          where: { userId: session.user.id },
          select: { willAttend: true, attended: true, completedAt: true },
        },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    return NextResponse.json(actions);
  } catch (error) {
    logError('Error fetching user actions', error);
    return NextResponse.json({ error: 'Failed to fetch actions' }, { status: 500 });
  }
}
