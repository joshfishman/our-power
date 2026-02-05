import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { getActionCanvassStats } from '@/lib/integrations';

// GET: Get detailed stats for a specific campaign
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        org: {
          select: { id: true, name: true },
        },
        cause: {
          select: { id: true, name: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, profilePhoto: true },
            },
          },
          orderBy: { joinedAt: 'desc' },
        },
        actions: {
          include: {
            _count: {
              select: { participants: true },
            },
            participants: {
              select: {
                willAttend: true,
                attended: true,
                userId: true,
              },
            },
          },
          orderBy: { dueDate: 'asc' },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Authorization: check if user is an org manager or campaign member
    const isOrgManager = await prisma.organization.findFirst({
      where: { id: campaign.org.id, managers: { some: { id: session.user!.id } } },
    });
    const isMember = campaign.members.some((m) => m.userId === session.user?.id);
    if (!isOrgManager && !isMember) {
      return NextResponse.json({ error: 'Not authorized to view this dashboard' }, { status: 403 });
    }

    // Check if user is an organizer
    const isOrganizer =
      !!isOrgManager ||
      campaign.members.some((m) => m.userId === session.user?.id && ['ORGANIZER', 'ADMIN'].includes(m.role));

    // Calculate detailed stats
    const actionStats = await Promise.all(
      campaign.actions.map(async (action) => {
        let canvassStats = null;

        // Fetch Ecanvasser stats if available
        if (action.type === 'CANVASS' && action.ecanvasserCampaignId) {
          canvassStats = await getActionCanvassStats(action.ecanvasserCampaignId);
        }

        return {
          id: action.id,
          title: action.title,
          type: action.type,
          dueDate: action.dueDate,
          isActive: action.isActive,
          totalRSVPs: action.participants.filter((p) => p.willAttend).length,
          totalCompleted: action.participants.filter((p) => p.attended).length,
          canvassStats,
        };
      }),
    );

    // Member growth over time (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const membersByDay: Record<string, number> = {};

    campaign.members.forEach((member) => {
      if (member.joinedAt >= thirtyDaysAgo) {
        const day = member.joinedAt.toISOString().split('T')[0];
        membersByDay[day] = (membersByDay[day] || 0) + 1;
      }
    });

    // Top participants
    const participationCounts: Record<string, number> = {};
    campaign.actions.forEach((action) => {
      action.participants.forEach((p) => {
        if (p.attended) {
          participationCounts[p.userId] = (participationCounts[p.userId] || 0) + 1;
        }
      });
    });

    const topParticipants = Object.entries(participationCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([userId, count]) => {
        const member = campaign.members.find((m) => m.userId === userId);
        return {
          userId,
          name: member?.user.name || 'Unknown',
          profilePhoto: member?.user.profilePhoto,
          completedActions: count,
        };
      });

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        type: campaign.type,
        status: campaign.status,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        organization: campaign.org,
        cause: campaign.cause,
      },
      isOrganizer,
      stats: {
        totalMembers: campaign.members.length,
        totalActions: campaign.actions.length,
        activeActions: campaign.actions.filter((a) => a.isActive).length,
        totalRSVPs: campaign.actions.reduce((sum, a) => sum + a.participants.filter((p) => p.willAttend).length, 0),
        totalCompleted: campaign.actions.reduce((sum, a) => sum + a.participants.filter((p) => p.attended).length, 0),
      },
      actionStats,
      memberGrowth: membersByDay,
      topParticipants,
    });
  } catch (error) {
    console.error('Campaign dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch campaign dashboard' }, { status: 500 });
  }
}
