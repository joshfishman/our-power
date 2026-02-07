import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { organizationSchema } from '@/lib/validations/organization';
import { withCors, corsOptionsResponse, enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

// GET /api/organizations/[id] - Get single organization
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    const organizationId = z.string().min(1).safeParse(params.id);
    if (!organizationId.success) {
      return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId.data },
      include: {
        managers: {
          select: { id: true, name: true, image: true },
        },
        campaigns: {
          select: {
            id: true,
            name: true,
            status: true,
            _count: { select: { members: true, actions: true } },
          },
        },
        _count: { select: { campaigns: true } },
      },
    });

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Only include manager emails if the requester is a manager
    const isManager = session?.user?.id && organization.managers.some((m) => m.id === session.user!.id);
    if (isManager) {
      // Re-fetch with emails for managers
      const withEmails = await prisma.organization.findUnique({
        where: { id: organizationId.data },
        include: {
          managers: {
            select: { id: true, name: true, email: true, image: true },
          },
          campaigns: {
            select: {
              id: true,
              name: true,
              status: true,
              _count: { select: { members: true, actions: true } },
            },
          },
          _count: { select: { campaigns: true } },
        },
      });
      return withCors(NextResponse.json(withEmails), request);
    }

    return withCors(NextResponse.json(organization), request);
  } catch (error) {
    logError('Error fetching organization', error);
    return withCors(NextResponse.json({ error: 'Failed to fetch organization' }, { status: 500 }), request);
  }
}

// PATCH /api/organizations/[id] - Update organization
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organizationId = z.string().min(1).safeParse(params.id);
    if (!organizationId.success) {
      return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 });
    }

    // Verify user is a manager
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId.data,
        managers: { some: { id: session.user.id } },
      },
    });

    if (!org) {
      return NextResponse.json({ error: 'Not authorized to edit this organization' }, { status: 403 });
    }

    const body = await request.json();
    const validatedData = organizationSchema.partial().parse(body);

    const organization = await prisma.organization.update({
      where: { id: organizationId.data },
      data: validatedData,
      include: {
        managers: {
          select: { id: true, name: true, image: true },
        },
      },
    });

    return NextResponse.json(organization);
  } catch (error) {
    logError('Error updating organization', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }
}

// DELETE /api/organizations/[id] - Delete organization
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organizationId = z.string().min(1).safeParse(params.id);
    if (!organizationId.success) {
      return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 });
    }

    // Verify user is a manager
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId.data,
        managers: { some: { id: session.user.id } },
      },
    });

    if (!org) {
      return NextResponse.json({ error: 'Not authorized to delete this organization' }, { status: 403 });
    }

    await prisma.organization.delete({
      where: { id: organizationId.data },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Error deleting organization', error);
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
  }
}
