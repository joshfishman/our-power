import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { logCampaignJoin } from '@/lib/notifications/campaignNotifications';
import { z } from 'zod';

// POST /api/campaigns/[id]/join - Join a campaign
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const campaignId = z.string().cuid().safeParse(params.id);
    if (!campaignId.success) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    // Check if campaign exists and is active
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId.data },
    });

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (campaign.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'This campaign is not currently accepting members' }, { status: 400 });
    }

    // Check if already a member
    const existingMembership = await prisma.campaignMember.findUnique({
      where: {
        userId_campaignId: {
          userId: session.user.id,
          campaignId: campaignId.data,
        },
      },
    });

    if (existingMembership) {
      return NextResponse.json({ error: 'You are already a member of this campaign' }, { status: 400 });
    }

    // Create membership
    const membership = await prisma.campaignMember.create({
      data: {
        userId: session.user.id,
        campaignId: campaignId.data,
        role: 'MEMBER',
      },
      include: {
        campaign: { select: { name: true } },
      },
    });

    await logCampaignJoin({ userId: session.user.id, campaignId: campaignId.data });

    return NextResponse.json({
      success: true,
      membership,
      message: `You've joined ${membership.campaign.name}!`,
    });
  } catch (error) {
    logError('Error joining campaign', error);
    return NextResponse.json({ error: 'Failed to join campaign' }, { status: 500 });
  }
}

// GET /api/campaigns/[id]/join - Check membership status
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const campaignId = z.string().cuid().safeParse(params.id);
    if (!campaignId.success) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    const membership = await prisma.campaignMember.findUnique({
      where: {
        userId_campaignId: {
          userId: session.user.id,
          campaignId: campaignId.data,
        },
      },
      include: {
        campaign: { select: { name: true } },
      },
    });

    if (!membership) {
      return NextResponse.json({ isMember: false }, { status: 200 });
    }

    return NextResponse.json({
      isMember: true,
      role: membership.role,
      joinedAt: membership.joinedAt,
      campaignName: membership.campaign.name,
    });
  } catch (error) {
    logError('Error checking membership', error);
    return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
  }
}

// DELETE /api/campaigns/[id]/join - Leave a campaign
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const campaignId = z.string().cuid().safeParse(params.id);
    if (!campaignId.success) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    const membership = await prisma.campaignMember.findUnique({
      where: {
        userId_campaignId: {
          userId: session.user.id,
          campaignId: campaignId.data,
        },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: 'You are not a member of this campaign' }, { status: 400 });
    }

    await prisma.campaignMember.delete({
      where: { id: membership.id },
    });

    return NextResponse.json({ success: true, message: "You've left the campaign" });
  } catch (error) {
    logError('Error leaving campaign', error);
    return NextResponse.json({ error: 'Failed to leave campaign' }, { status: 500 });
  }
}
