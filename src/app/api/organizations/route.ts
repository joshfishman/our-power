import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { organizationSchema } from '@/lib/validations/organization';
import { withCors, corsOptionsResponse, enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';

const cacheHeaders = {
  'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400',
};

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

// GET /api/organizations - List organizations
export async function GET(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const managed = searchParams.get('managed') === 'true';

    let where = {};

    // If managed=true, only return orgs the user manages
    if (managed && session?.user?.id) {
      where = {
        managers: { some: { id: session.user.id } },
      };
    }

    const organizations = await prisma.organization.findMany({
      where,
      include: {
        managers: {
          select: { id: true, name: true, image: true },
        },
        _count: { select: { campaigns: true } },
      },
      orderBy: { name: 'asc' },
    });

    return withCors(NextResponse.json(organizations, { headers: cacheHeaders }), request);
  } catch (error) {
    logError('Error fetching organizations', error);
    return withCors(NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 }), request);
  }
}

// POST /api/organizations - Create organization
export async function POST(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = organizationSchema.parse(body);

    // Create organization with the current user as the first manager
    const organization = await prisma.organization.create({
      data: {
        name: validatedData.name,
        description: validatedData.description,
        logoUrl: validatedData.logoUrl,
        website: validatedData.website,
        managers: {
          connect: { id: session.user.id },
        },
      },
      include: {
        managers: {
          select: { id: true, name: true, image: true },
        },
      },
    });

    return NextResponse.json(organization, { status: 201 });
  } catch (error) {
    logError('Error creating organization', error);

    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid data', details: error }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
