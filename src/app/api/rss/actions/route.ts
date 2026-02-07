import prisma from '@/lib/prisma/prisma';
import { buildRssFeed, rssResponse, getSiteUrl } from '@/lib/rss';
import type { NextRequest } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 120, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const siteUrl = getSiteUrl();

  const validTypes = ['EVENT', 'PHONE', 'EMAIL', 'CANVASS'];
  const typeFilter =
    type && validTypes.includes(type.toUpperCase())
      ? { type: type.toUpperCase() as 'EVENT' | 'PHONE' | 'EMAIL' | 'CANVASS' }
      : {};

  try {
    const actions = await prisma.action.findMany({
      where: {
        isActive: true,
        dueDate: { gte: new Date() },
        ...typeFilter,
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            cause: { select: { name: true, icon: true } },
          },
        },
        _count: { select: { participants: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    const xml = buildRssFeed({
      title: 'Our Power - Upcoming Actions',
      description: 'Upcoming activism actions across all campaigns on Our Power',
      link: `${siteUrl}/campaigns`,
      items: actions.map((a) => ({
        title: a.title,
        link: `${siteUrl}/c/${a.campaign.id}`,
        description: a.description || a.title,
        pubDate: a.createdAt,
        guid: `${siteUrl}/c/${a.campaign.id}#action-${a.id}`,
        customElements: {
          'op:actionType': a.type,
          'op:campaign': a.campaign.name,
          'op:cause': a.campaign.cause.name,
          'op:dueDate': a.dueDate.toISOString(),
          'op:participantCount': String(a._count.participants),
          ...(a.location ? { 'op:location': a.location } : {}),
        },
      })),
    });

    return rssResponse(xml);
  } catch (error) {
    logError('RSS actions feed error', error);
    return new Response('Failed to build RSS feed', { status: 500 });
  }
}
