import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';

// GET /api/me/campaigns - Get current user's campaigns
export async function GET(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const memberships = await prisma.campaignMember.findMany({
      where: { userId: session.user.id },
      include: {
        campaign: {
          include: {
            cause: { select: { id: true, name: true, icon: true, color: true } },
            org: { select: { id: true, name: true, logoUrl: true } },
            _count: { select: { members: true, actions: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const campaigns = memberships.map((m) => ({
      ...m.campaign,
      joinedAt: m.joinedAt,
      role: m.role,
    }));

    return NextResponse.json(campaigns);
  } catch (error) {
    logError('Error fetching user campaigns', error);
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}
