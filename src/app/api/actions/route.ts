import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { actionSchema } from '@/lib/validations/campaign';
import { withCors, corsOptionsResponse, isRateLimited, rateLimitedResponse } from '@/lib/api-utils';

export async function OPTIONS() {
  return corsOptionsResponse();
}

// GET /api/actions - List actions
export async function GET(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    if (isRateLimited(ip)) return rateLimitedResponse();
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');
    const type = searchParams.get('type');
    const upcoming = searchParams.get('upcoming') === 'true';
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { isActive: true };

    if (campaignId) where.campaignId = campaignId;
    if (type) where.type = type;
    if (upcoming) {
      where.dueDate = { gte: new Date() };
    }

    const actions = await prisma.action.findMany({
      where,
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            cause: { select: { name: true, icon: true } },
          },
        },
        _count: { select: { participants: true } },
        // Include user's participation status if logged in
        ...(session?.user?.id && {
          participants: {
            where: { userId: session.user.id },
            select: { willAttend: true, attended: true },
          },
        }),
      },
      orderBy: { dueDate: 'asc' },
      take: limit,
    });

    return withCors(NextResponse.json(actions));
  } catch (error) {
    console.error('Error fetching actions:', error);
    return withCors(NextResponse.json({ error: 'Failed to fetch actions' }, { status: 500 }));
  }
}

// POST /api/actions - Create action
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = actionSchema.parse(body);

    // Verify user can create actions for this campaign
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: validatedData.campaignId,
        org: { managers: { some: { id: session.user.id } } },
      },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: 'You do not have permission to create actions for this campaign' },
        { status: 403 },
      );
    }

    const action = await prisma.action.create({
      data: {
        title: validatedData.title,
        description: validatedData.description,
        type: validatedData.type,
        dueDate: new Date(validatedData.dueDate),
        campaignId: validatedData.campaignId,

        // EVENT fields
        location: validatedData.location,
        eventTime: validatedData.eventTime ? new Date(validatedData.eventTime) : null,
        eventEndTime: validatedData.eventEndTime ? new Date(validatedData.eventEndTime) : null,
        locationUrl: validatedData.locationUrl,

        // PHONE fields
        callScript: validatedData.callScript,
        phoneNumbers: validatedData.phoneNumbers || [],
        dialerUrl: validatedData.dialerUrl,

        // EMAIL fields
        emailSubject: validatedData.emailSubject,
        emailBody: validatedData.emailBody,
        emailTargets: validatedData.emailTargets || [],

        // CANVASS fields
        canvassArea: validatedData.canvassArea,
        canvassTurf: validatedData.canvassTurf,
        ecanvasserCampaignId: validatedData.ecanvasserCampaignId,

        // Shareable
        graphics: validatedData.graphics || [],
        shareText: validatedData.shareText,
      },
      include: {
        campaign: { select: { name: true } },
      },
    });

    return NextResponse.json(action, { status: 201 });
  } catch (error) {
    console.error('Error creating action:', error);

    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid data', details: error }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to create action' }, { status: 500 });
  }
}
