import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { z } from 'zod';

const participationSchema = z.object({
  willAttend: z.boolean().optional(),
  attended: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

// POST /api/actions/[id]/participate - RSVP or mark completion
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = participationSchema.parse(body);

    // Check if action exists
    const action = await prisma.action.findUnique({
      where: { id: params.id },
      include: { campaign: { select: { id: true, name: true } } },
    });

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    // Check if user is a campaign member
    const membership = await prisma.campaignMember.findUnique({
      where: {
        userId_campaignId: {
          userId: session.user.id,
          campaignId: action.campaignId,
        },
      },
    });

    if (!membership) {
      return NextResponse.json(
        { error: 'You must join the campaign first to participate in actions' },
        { status: 400 },
      );
    }

    // Upsert participation
    const participation = await prisma.actionParticipation.upsert({
      where: {
        userId_actionId: {
          userId: session.user.id,
          actionId: params.id,
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
        actionId: params.id,
        willAttend: validatedData.willAttend ?? false,
        attended: validatedData.attended ?? false,
        completedAt: validatedData.attended ? new Date() : null,
        notes: validatedData.notes,
      },
    });

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
    console.error('Error updating participation:', error);
    return NextResponse.json({ error: 'Failed to update participation' }, { status: 500 });
  }
}

// GET /api/actions/[id]/participate - Get user's participation status
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const participation = await prisma.actionParticipation.findUnique({
      where: {
        userId_actionId: {
          userId: session.user.id,
          actionId: params.id,
        },
      },
    });

    return NextResponse.json(participation || { willAttend: false, attended: false });
  } catch (error) {
    console.error('Error fetching participation:', error);
    return NextResponse.json({ error: 'Failed to fetch participation' }, { status: 500 });
  }
}
