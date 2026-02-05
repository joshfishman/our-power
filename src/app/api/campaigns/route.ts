import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { campaignSchema } from '@/lib/validations/campaign';

// GET /api/campaigns - List campaigns
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const causeId = searchParams.get('causeId');
    const status = searchParams.get('status');
    const orgId = searchParams.get('orgId');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};

    if (causeId) where.causeId = causeId;
    if (status) where.status = status;
    if (orgId) where.orgId = orgId;

    // By default, only show active campaigns
    if (!status) {
      where.status = 'ACTIVE';
    }

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        include: {
          cause: { select: { id: true, name: true, icon: true, color: true } },
          org: { select: { id: true, name: true, logoUrl: true } },
          _count: { select: { members: true, actions: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.campaign.count({ where }),
    ]);

    return NextResponse.json({
      campaigns,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}

// POST /api/campaigns - Create campaign
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = campaignSchema.parse(body);

    // Verify user is a manager of the organization
    const org = await prisma.organization.findFirst({
      where: {
        id: validatedData.orgId,
        managers: { some: { id: session.user.id } },
      },
    });

    if (!org) {
      return NextResponse.json({ error: 'You must be an organization manager to create campaigns' }, { status: 403 });
    }

    const campaign = await prisma.campaign.create({
      data: {
        name: validatedData.name,
        description: validatedData.description,
        type: validatedData.type,
        status: validatedData.status || 'DRAFT',
        imageUrl: validatedData.imageUrl,
        startDate: validatedData.startDate ? new Date(validatedData.startDate) : null,
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : null,
        causeId: validatedData.causeId,
        orgId: validatedData.orgId,
      },
      include: {
        cause: true,
        org: true,
      },
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error('Error creating campaign:', error);

    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid data', details: error }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}
