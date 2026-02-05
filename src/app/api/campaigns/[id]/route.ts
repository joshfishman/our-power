import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { campaignSchema } from '@/lib/validations/campaign';
import { withCors, corsOptionsResponse, isRateLimited, rateLimitedResponse } from '@/lib/api-utils';

export async function OPTIONS() {
  return corsOptionsResponse();
}

// GET /api/campaigns/[id] - Get single campaign
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    if (isRateLimited(ip)) return rateLimitedResponse();
    const campaign = await prisma.campaign.findUnique({
      where: { id: params.id },
      include: {
        cause: { select: { id: true, name: true, icon: true, color: true } },
        org: { select: { id: true, name: true, logoUrl: true, description: true } },
        actions: {
          where: { isActive: true },
          orderBy: { dueDate: 'asc' },
          take: 10,
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            dueDate: true,
            // EVENT fields
            location: true,
            eventTime: true,
            locationUrl: true,
            // PHONE fields
            callScript: true,
            dialerUrl: true,
            // EMAIL fields
            emailSubject: true,
            emailBody: true,
            emailTargets: true,
            // CANVASS fields
            canvassArea: true,
            ecanvasserCampaignId: true,
            _count: { select: { participants: true } },
          },
        },
        _count: { select: { members: true, actions: true } },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return withCors(NextResponse.json(campaign));
  } catch (error) {
    console.error('Error fetching campaign:', error);
    return withCors(NextResponse.json({ error: 'Failed to fetch campaign' }, { status: 500 }));
  }
}

// PATCH /api/campaigns/[id] - Update campaign
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user can edit this campaign
    const existingCampaign = await prisma.campaign.findFirst({
      where: {
        id: params.id,
        org: { managers: { some: { id: session.user.id } } },
      },
    });

    if (!existingCampaign) {
      return NextResponse.json(
        { error: 'Campaign not found or you do not have permission to edit it' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const validatedData = campaignSchema.partial().parse(body);

    const campaign = await prisma.campaign.update({
      where: { id: params.id },
      data: {
        ...validatedData,
        startDate: validatedData.startDate ? new Date(validatedData.startDate) : undefined,
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : undefined,
      },
      include: {
        cause: true,
        org: true,
      },
    });

    return NextResponse.json(campaign);
  } catch (error) {
    console.error('Error updating campaign:', error);
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 });
  }
}

// DELETE /api/campaigns/[id] - Delete campaign
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user can delete this campaign
    const existingCampaign = await prisma.campaign.findFirst({
      where: {
        id: params.id,
        org: { managers: { some: { id: session.user.id } } },
      },
    });

    if (!existingCampaign) {
      return NextResponse.json(
        { error: 'Campaign not found or you do not have permission to delete it' },
        { status: 403 },
      );
    }

    await prisma.campaign.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 });
  }
}
