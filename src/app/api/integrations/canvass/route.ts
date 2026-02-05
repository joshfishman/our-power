import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { generateCanvassDeepLink, getActionCanvassStats, syncActionToEcanvasser } from '@/lib/integrations';

// POST: Start a canvassing session
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
        console.error('Ecanvasser sync error:', err);
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
    console.error('Canvass session error:', error);
    return NextResponse.json({ error: 'Failed to start canvass session' }, { status: 500 });
  }
}

// GET: Get canvass stats for an action
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const actionId = searchParams.get('actionId');

  if (!actionId) {
    return NextResponse.json({ error: 'Action ID required' }, { status: 400 });
  }

  try {
    const action = await prisma.action.findUnique({
      where: { id: actionId },
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
    console.error('Canvass stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch canvass stats' }, { status: 500 });
  }
}
