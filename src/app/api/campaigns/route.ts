import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { campaignSchema } from '@/lib/validations/campaign';
import { withCors, corsOptionsResponse, enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

const cacheHeaders = {
  'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400',
};

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

// GET /api/campaigns - List campaigns
export async function GET(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
    const { searchParams } = new URL(request.url);
    const causeId = searchParams.get('causeId');
    const status = searchParams.get('status');
    const orgId = searchParams.get('orgId');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (causeId) {
      const parsedCauseId = z.string().cuid().safeParse(causeId);
      if (!parsedCauseId.success) {
        return withCors(NextResponse.json({ error: 'Invalid cause id' }, { status: 400 }), request);
      }
      where.causeId = parsedCauseId.data;
    }
    if (status) where.status = status;
    if (orgId) {
      const parsedOrgId = z.string().cuid().safeParse(orgId);
      if (!parsedOrgId.success) {
        return withCors(NextResponse.json({ error: 'Invalid organization id' }, { status: 400 }), request);
      }
      where.orgId = parsedOrgId.data;
    }

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

    return withCors(
      NextResponse.json(
        {
          campaigns,
          total,
          limit,
          offset,
        },
        { headers: cacheHeaders },
      ),
      request,
    );
  } catch (error) {
    logError('Error fetching campaigns', error);
    return withCors(NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 }), request);
  }
}

// POST /api/campaigns - Create campaign
export async function POST(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
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
    logError('Error creating campaign', error);

    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid data', details: error }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}
