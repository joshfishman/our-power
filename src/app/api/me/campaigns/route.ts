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

    // 1. Campaigns the user has joined as a member
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

    const joinedCampaigns = memberships.map((m) => ({
      ...m.campaign,
      joinedAt: m.joinedAt,
      role: m.role,
    }));

    // 2. Campaigns created by orgs the user manages (they are the creator/manager)
    const managedCampaigns = await prisma.campaign.findMany({
      where: {
        org: { managers: { some: { id: session.user.id } } },
      },
      include: {
        cause: { select: { id: true, name: true, icon: true, color: true } },
        org: { select: { id: true, name: true, logoUrl: true } },
        _count: { select: { members: true, actions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Merge and deduplicate (joined campaigns take precedence for role/joinedAt)
    const joinedIds = new Set(joinedCampaigns.map((c) => c.id));
    const managerOnly = managedCampaigns
      .filter((c) => !joinedIds.has(c.id))
      .map((c) => ({
        ...c,
        joinedAt: c.createdAt,
        role: 'MANAGER' as const,
      }));

    const campaigns = [...joinedCampaigns, ...managerOnly];

    return NextResponse.json(campaigns);
  } catch (error) {
    logError('Error fetching user campaigns', error);
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}
