import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { generateCanvassDeepLink, getActionCanvassStats, syncActionToEcanvasser } from '@/lib/integrations';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError, logWarn } from '@/lib/logger';
import { z } from 'zod';

// POST: Start a canvassing session
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const parsed = z.object({ actionId: z.string().cuid() }).safeParse(body);
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

    if (action.type !== 'CANVASS') {
      return NextResponse.json({ error: 'Action is not a canvassing action' }, { status: 400 });
    }

    // If no Ecanvasser campaign linked, create one
    let { ecanvasserCampaignId } = action;

    if (!ecanvasserCampaignId && process.env.ECANVASSER_API_KEY) {
      try {
        const sync = await syncActionToEcanvasser({
          id: action.id,
          title: action.title,
          canvassArea: action.canvassArea || undefined,
          campaignId: action.campaignId,
        });
        ecanvasserCampaignId = sync.ecanvasserCampaignId;

        // Update action with Ecanvasser campaign ID
        await prisma.action.update({
          where: { id: actionId },
          data: { ecanvasserCampaignId },
        });
      } catch (err) {
        logWarn('Ecanvasser sync error', { error: err });
        // Continue without Ecanvasser link
      }
    }

    // Generate deep link if we have an Ecanvasser campaign
    const canvassUrl = ecanvasserCampaignId ? generateCanvassDeepLink(ecanvasserCampaignId) : null;

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
      canvassUrl,
      ecanvasserCampaignId,
      canvassArea: action.canvassArea,
      canvassTurf: action.canvassTurf,
    });
  } catch (error) {
    logError('Canvass session error', error);
    return NextResponse.json({ error: 'Failed to start canvass session' }, { status: 500 });
  }
}

// GET: Get canvass stats for an action
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimitResponse = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const actionId = searchParams.get('actionId');

  if (!actionId) {
    return NextResponse.json({ error: 'Action ID required' }, { status: 400 });
  }
  const parsedActionId = z.string().cuid().safeParse(actionId);
  if (!parsedActionId.success) {
    return NextResponse.json({ error: 'Invalid action id' }, { status: 400 });
  }

  try {
    const action = await prisma.action.findUnique({
      where: { id: parsedActionId.data },
    });

    if (!action?.ecanvasserCampaignId) {
      return NextResponse.json({ error: 'No Ecanvasser campaign linked' }, { status: 404 });
    }

    const stats = await getActionCanvassStats(action.ecanvasserCampaignId);

    if (!stats) {
      return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }

    return NextResponse.json(stats);
  } catch (error) {
    logError('Canvass stats error', error);
    return NextResponse.json({ error: 'Failed to fetch canvass stats' }, { status: 500 });
  }
}
