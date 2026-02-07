import prisma from '@/lib/prisma/prisma';
import { buildRssFeed, rssResponse, getSiteUrl } from '@/lib/rss';
import type { NextRequest } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 120, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const causeId = searchParams.get('causeId');
  const siteUrl = getSiteUrl();

  if (causeId) {
    const parsedCauseId = z.string().cuid().safeParse(causeId);
    if (!parsedCauseId.success) {
      return new Response('Invalid cause id', { status: 400 });
    }
  }

  try {
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
        ...(causeId ? { causeId } : {}),
      },
      include: {
        cause: { select: { name: true, icon: true } },
        org: { select: { name: true } },
        _count: { select: { members: true, actions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const xml = buildRssFeed({
      title: 'Our Power - Campaigns',
      description: 'Active activism campaigns on Our Power',
      link: `${siteUrl}/campaigns`,
      items: campaigns.map((c) => ({
        title: c.name,
        link: `${siteUrl}/c/${c.id}`,
        description: c.description,
        pubDate: c.createdAt,
        guid: `${siteUrl}/c/${c.id}`,
        customElements: {
          'op:cause': c.cause.name,
          'op:organization': c.org.name,
          'op:type': c.type,
          'op:memberCount': String(c._count.members),
          'op:actionCount': String(c._count.actions),
        },
      })),
    });

    return rssResponse(xml);
  } catch (error) {
    logError('RSS campaigns feed error', error);
    return new Response('Failed to build RSS feed', { status: 500 });
  }
}
