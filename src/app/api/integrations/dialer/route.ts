import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { generateUserDialerLink, trackSessionStart } from '@/lib/integrations';

// POST: Start a phone banking session
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { actionId } = await request.json();

    const action = await prisma.action.findUnique({
      where: { id: actionId },
      include: { campaign: true },
    });

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    if (action.type !== 'PHONE') {
      return NextResponse.json({ error: 'Action is not a phone banking action' }, { status: 400 });
    }

    if (!action.dialerUrl) {
      return NextResponse.json({ error: 'No dialer URL configured for this action' }, { status: 400 });
    }

    // Generate personalized dialer link
    const dialerUrl = generateUserDialerLink({ campaignUrl: action.dialerUrl }, session.user.id, actionId);

    // Track session start
    const sessionInfo = await trackSessionStart(session.user.id, actionId);

    // Create or update participation record
    await prisma.actionParticipation.upsert({
      where: {
        userId_actionId: {
          userId: session.user.id,
          actionId,
        },
      },
      create: {
        actionId,
        userId: session.user.id,
        willAttend: true,
      },
      update: {
        willAttend: true,
      },
    });

    return NextResponse.json({
      dialerUrl,
      sessionId: sessionInfo.sessionId,
      callScript: action.callScript,
      phoneNumbers: action.phoneNumbers,
    });
  } catch (error) {
    console.error('Dialer session error:', error);
    return NextResponse.json({ error: 'Failed to start dialer session' }, { status: 500 });
  }
}
