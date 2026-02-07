import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { addManagerSchema } from '@/lib/validations/organization';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

// POST /api/organizations/[id]/managers - Add a manager to organization
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organizationId = z.string().cuid().safeParse(params.id);
    if (!organizationId.success) {
      return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 });
    }

    // Verify current user is a manager
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId.data,
        managers: { some: { id: session.user.id } },
      },
    });

    if (!org) {
      return NextResponse.json({ error: 'Not authorized to manage this organization' }, { status: 403 });
    }

    const body = await request.json();
    const { userEmail } = addManagerSchema.omit({ organizationId: true }).parse(body);

    // Find user by email
    const userToAdd = await prisma.user.findUnique({
      where: { email: userEmail },
    });

    if (!userToAdd) {
      return NextResponse.json({ error: 'User not found with that email' }, { status: 404 });
    }

    // Add user as manager
    const organization = await prisma.organization.update({
      where: { id: organizationId.data },
      data: {
        managers: {
          connect: { id: userToAdd.id },
        },
      },
      include: {
        managers: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    return NextResponse.json(organization);
  } catch (error) {
    logError('Error adding manager', error);
    return NextResponse.json({ error: 'Failed to add manager' }, { status: 500 });
  }
}

// DELETE /api/organizations/[id]/managers - Remove a manager from organization
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organizationId = z.string().cuid().safeParse(params.id);
    if (!organizationId.success) {
      return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 });
    }

    // Verify current user is a manager
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId.data,
        managers: { some: { id: session.user.id } },
      },
      include: {
        managers: true,
      },
    });

    if (!org) {
      return NextResponse.json({ error: 'Not authorized to manage this organization' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userIdToRemove = searchParams.get('userId');

    if (!userIdToRemove) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const parsedUserIdToRemove = z.string().cuid().safeParse(userIdToRemove);
    if (!parsedUserIdToRemove.success) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    // Prevent removing the last manager
    if (org.managers.length <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last manager' }, { status: 400 });
    }

    // Remove user as manager
    const organization = await prisma.organization.update({
      where: { id: organizationId.data },
      data: {
        managers: {
          disconnect: { id: parsedUserIdToRemove.data },
        },
      },
      include: {
        managers: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    return NextResponse.json(organization);
  } catch (error) {
    logError('Error removing manager', error);
    return NextResponse.json({ error: 'Failed to remove manager' }, { status: 500 });
  }
}
