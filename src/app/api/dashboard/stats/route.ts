import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';

// GET: Get aggregated stats for dashboard
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');
  const orgId = searchParams.get('orgId');
  const timeframe = searchParams.get('timeframe') || '30d'; // 7d, 30d, 90d, all

  try {
    // Calculate date range
    const now = new Date();
    let startDate: Date | undefined;

    switch (timeframe) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        startDate = undefined;
        break;
    }

    // Build where clause
    const actionWhere: { isActive: boolean; campaignId?: string; createdAt?: { gte: Date } } = { isActive: true };
    if (campaignId) actionWhere.campaignId = campaignId;
    if (startDate) actionWhere.createdAt = { gte: startDate };

    const campaignWhere: { id?: string; orgId?: string } = {};
    if (campaignId) campaignWhere.id = campaignId;
    if (orgId) campaignWhere.orgId = orgId;

    // Get campaign stats
    const campaigns = await prisma.campaign.findMany({
      where: campaignWhere,
      include: {
        _count: {
          select: {
            members: true,
            actions: true,
          },
        },
      },
    });

    // Get action stats
    const actions = await prisma.action.findMany({
      where: actionWhere,
      include: {
        _count: {
          select: {
            participants: true,
          },
        },
        participants: {
          select: {
            willAttend: true,
            attended: true,
          },
        },
      },
    });

    // Get participation stats
    const participationWhere: { createdAt?: { gte: Date }; action?: { campaignId: string } } = {};
    if (startDate) participationWhere.createdAt = { gte: startDate };
    if (campaignId) {
      participationWhere.action = { campaignId };
    }

    const participations = await prisma.actionParticipation.findMany({
      where: participationWhere,
      include: {
        action: {
          select: { type: true },
        },
      },
    });

    // Calculate aggregated stats
    const stats = {
      overview: {
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter((c) => c.status === 'ACTIVE').length,
        totalMembers: campaigns.reduce((sum, c) => sum + c._count.members, 0),
        totalActions: actions.length,
      },
      participation: {
        totalRSVPs: participations.filter((p) => p.willAttend).length,
        totalCompleted: participations.filter((p) => p.attended).length,
        completionRate:
          participations.length > 0
            ? Math.round(
                (participations.filter((p) => p.attended).length / participations.filter((p) => p.willAttend).length) *
                  100,
              )
            : 0,
      },
      byActionType: {
        EVENT: {
          actions: actions.filter((a) => a.type === 'EVENT').length,
          rsvps: participations.filter((p) => p.action.type === 'EVENT' && p.willAttend).length,
          completed: participations.filter((p) => p.action.type === 'EVENT' && p.attended).length,
        },
        PHONE: {
          actions: actions.filter((a) => a.type === 'PHONE').length,
          rsvps: participations.filter((p) => p.action.type === 'PHONE' && p.willAttend).length,
          completed: participations.filter((p) => p.action.type === 'PHONE' && p.attended).length,
        },
        EMAIL: {
          actions: actions.filter((a) => a.type === 'EMAIL').length,
          rsvps: participations.filter((p) => p.action.type === 'EMAIL' && p.willAttend).length,
          completed: participations.filter((p) => p.action.type === 'EMAIL' && p.attended).length,
        },
        CANVASS: {
          actions: actions.filter((a) => a.type === 'CANVASS').length,
          rsvps: participations.filter((p) => p.action.type === 'CANVASS' && p.willAttend).length,
          completed: participations.filter((p) => p.action.type === 'CANVASS' && p.attended).length,
        },
      },
      timeframe,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard stats' }, { status: 500 });
  }
}
