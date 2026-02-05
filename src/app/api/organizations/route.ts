import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { organizationSchema } from '@/lib/validations/organization';
import { withCors, corsOptionsResponse, isRateLimited, rateLimitedResponse } from '@/lib/api-utils';

export async function OPTIONS() {
  return corsOptionsResponse();
}

// GET /api/organizations - List organizations
export async function GET(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    if (isRateLimited(ip)) return rateLimitedResponse();
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

    return withCors(NextResponse.json(organizations));
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return withCors(NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 }));
  }
}

// POST /api/organizations - Create organization
export async function POST(request: Request) {
  try {
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
    console.error('Error creating organization:', error);

    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid data', details: error }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
