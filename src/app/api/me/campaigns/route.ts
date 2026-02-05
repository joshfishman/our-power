import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';

// GET /api/me/campaigns - Get current user's campaigns
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const memberships = await prisma.campaignMember.findMany({
      where: { userId: session.user.id },
      include: {
        campaign: {
          include: {
            cause: { select: { id: true, name: true, icon: true, color: true } },
            org: { select: { id: true, name: true, logoUrl: true } },
            _count: { select: { members: true, actions: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const campaigns = memberships.map((m) => ({
      ...m.campaign,
      joinedAt: m.joinedAt,
      role: m.role,
    }));

    return NextResponse.json(campaigns);
  } catch (error) {
    console.error('Error fetching user campaigns:', error);
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}
