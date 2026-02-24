import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

const roleSchema = z.enum(['MEMBER', 'ORGANIZER', 'ADMIN']);

// PATCH /api/campaigns/[id]/members/[userId] - Update a campaign member role
export async function PATCH(request: Request, { params }: { params: { id: string; userId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedCampaignId = z.string().min(1).safeParse(params.id);
  const parsedUserId = z.string().min(1).safeParse(params.userId);
  if (!parsedCampaignId.success || !parsedUserId.success) {
    return NextResponse.json({ error: 'Invalid campaign or user id' }, { status: 400 });
  }

  const body = await request.json();
  const parsedRole = roleSchema.safeParse(body?.role);
  if (!parsedRole.success) {
    return NextResponse.json({ error: 'Invalid member role' }, { status: 400 });
  }

  const campaign = await prisma.campaign.findFirst({
    where: {
      id: parsedCampaignId.data,
      org: { managers: { some: { id: session.user.id } } },
    },
    select: { id: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updated = await prisma.campaignMember.update({
    where: {
      userId_campaignId: {
        userId: parsedUserId.data,
        campaignId: parsedCampaignId.data,
      },
    },
    data: {
      role: parsedRole.data,
    },
  });

  return NextResponse.json(updated);
}
