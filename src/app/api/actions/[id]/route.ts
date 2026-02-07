import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { actionSchema } from '@/lib/validations/campaign';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

// GET /api/actions/[id] - Get a single action
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;

    const actionId = z.string().min(1).safeParse(params.id);
    if (!actionId.success) {
      return NextResponse.json({ error: 'Invalid action id' }, { status: 400 });
    }

    const session = await auth();
    const userId = session?.user?.id;

    const action = await prisma.action.findUnique({
      where: { id: actionId.data },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            description: true,
            status: true,
            cause: { select: { id: true, name: true, icon: true, color: true } },
            org: { select: { id: true, name: true, logoUrl: true } },
          },
        },
        _count: { select: { participants: true } },
        ...(userId
          ? {
              participants: {
                where: { userId },
                select: { willAttend: true, attended: true, completedAt: true },
              },
            }
          : {}),
      },
    });

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json(action);
  } catch (error) {
    logError('Error fetching action', error);
    return NextResponse.json({ error: 'Failed to fetch action' }, { status: 500 });
  }
}

// PATCH /api/actions/[id] - Update an action
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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
    const validatedData = actionSchema.partial().omit({ campaignId: true }).parse(body);

    const existingAction = await prisma.action.findFirst({
      where: {
        id: actionId.data,
        campaign: { org: { managers: { some: { id: session.user.id } } } },
      },
    });

    if (!existingAction) {
      return NextResponse.json({ error: 'Action not found or you do not have permission to edit it' }, { status: 403 });
    }

    const action = await prisma.action.update({
      where: { id: actionId.data },
      data: {
        ...validatedData,
        dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : undefined,
        eventTime: validatedData.eventTime ? new Date(validatedData.eventTime) : undefined,
        eventEndTime: validatedData.eventEndTime ? new Date(validatedData.eventEndTime) : undefined,
      },
    });

    return NextResponse.json(action);
  } catch (error) {
    logError('Error updating action', error);
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid data', details: error }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update action' }, { status: 500 });
  }
}
