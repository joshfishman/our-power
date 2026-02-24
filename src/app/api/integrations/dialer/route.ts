import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

// POST: Start a phone banking session
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const parsed = z.object({ actionId: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid action id' }, { status: 400 });
    }
    const { actionId } = parsed.data;

    const action = await prisma.action.findUnique({
      where: { id: actionId },
      include: { campaign: true },
    });

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    if (action.type !== 'PHONE') {
      return NextResponse.json({ error: 'Action is not a call in support action' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Dialer sessions are not available for Call in Support actions.' },
      { status: 400 },
    );
  } catch (error) {
    logError('Dialer session error', error);
    return NextResponse.json({ error: 'Failed to start dialer session' }, { status: 500 });
  }
}
