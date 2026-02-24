import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { logActionCompleted, logActionRSVP, logCampaignJoin } from '@/lib/notifications/campaignNotifications';
import { z } from 'zod';

const participationSchema = z.object({
  willAttend: z.boolean().optional(),
  attended: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

// POST /api/actions/[id]/participate - RSVP or mark completion
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actionId = z.string().min(1).safeParse(params.id);
    if (!actionId.success) {
      return NextResponse.json({ error: 'Invalid action id' }, { status: 400 });
    }

    const body = await request.json();
    const validatedData = participationSchema.parse(body);

    // Check if action exists
    const action = await prisma.action.findUnique({
      where: { id: actionId.data },
      include: { campaign: { select: { id: true, name: true, status: true } } },
    });

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    if (action.type === 'EVENT' && validatedData.attended) {
      return NextResponse.json({ error: 'Event actions only support RSVP' }, { status: 400 });
    }

    // Auto-join the campaign if not already a member
    const membership = await prisma.campaignMember.findUnique({
      where: {
        userId_campaignId: {
          userId: session.user.id,
          campaignId: action.campaignId,
        },
      },
    });

    if (!membership) {
      if (action.campaign.status !== 'ACTIVE') {
        return NextResponse.json({ error: 'This campaign is not currently accepting members' }, { status: 400 });
      }
      await prisma.campaignMember.create({
        data: { userId: session.user.id, campaignId: action.campaignId, role: 'MEMBER' },
      });
      await logCampaignJoin({ userId: session.user.id, campaignId: action.campaignId });
    }

    const existingParticipation = await prisma.actionParticipation.findUnique({
      where: {
        userId_actionId: {
          userId: session.user.id,
          actionId: actionId.data,
        },
      },
    });

    // Upsert participation
    const participation = await prisma.actionParticipation.upsert({
      where: {
        userId_actionId: {
          userId: session.user.id,
          actionId: actionId.data,
        },
      },
      update: {
        willAttend: validatedData.willAttend,
        attended: validatedData.attended,
        completedAt: validatedData.attended ? new Date() : null,
        notes: validatedData.notes,
      },
      create: {
        userId: session.user.id,
        actionId: actionId.data,
        willAttend: validatedData.willAttend ?? false,
        attended: validatedData.attended ?? false,
        completedAt: validatedData.attended ? new Date() : null,
        notes: validatedData.notes,
      },
    });

    if (validatedData.willAttend && !existingParticipation?.willAttend) {
      await logActionRSVP({ userId: session.user.id, actionId: action.id, campaignId: action.campaignId });
    }
    if (validatedData.attended && !existingParticipation?.attended) {
      await logActionCompleted({ userId: session.user.id, actionId: action.id, campaignId: action.campaignId });
    }

    return NextResponse.json({
      success: true,
      participation,
      message: validatedData.attended
        ? 'Thanks for participating!'
        : validatedData.willAttend
        ? "You're signed up!"
        : 'Participation updated',
    });
  } catch (error) {
    logError('Error updating participation', error);
    return NextResponse.json({ error: 'Failed to update participation' }, { status: 500 });
  }
}

// GET /api/actions/[id]/participate - Get user's participation status
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actionId = z.string().min(1).safeParse(params.id);
    if (!actionId.success) {
      return NextResponse.json({ error: 'Invalid action id' }, { status: 400 });
    }

    const participation = await prisma.actionParticipation.findUnique({
      where: {
        userId_actionId: {
          userId: session.user.id,
          actionId: actionId.data,
        },
      },
    });

    return NextResponse.json(participation || { willAttend: false, attended: false });
  } catch (error) {
    logError('Error fetching participation', error);
    return NextResponse.json({ error: 'Failed to fetch participation' }, { status: 500 });
  }
}
