import prisma from '@/lib/prisma/prisma';
import { buildRssFeed, rssResponse, getSiteUrl } from '@/lib/rss';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const siteUrl = getSiteUrl();
  const parsedCauseId = z.string().min(1).safeParse(params.id);
  if (!parsedCauseId.success) {
    return new Response('Invalid cause id', { status: 400 });
  }
  const causeId = parsedCauseId.data;

  try {
    const cause = await prisma.cause.findUnique({
      where: { id: causeId },
      select: { id: true, name: true, description: true },
    });

    if (!cause) {
      return new Response('Cause not found', { status: 404 });
    }

    const campaigns = await prisma.campaign.findMany({
      where: {
        causeId,
        status: 'ACTIVE',
      },
      include: {
        org: { select: { name: true } },
        _count: { select: { members: true, actions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const xml = buildRssFeed({
      title: `Our Power - ${cause.name}`,
      description: cause.description || `Campaigns for ${cause.name}`,
      link: `${siteUrl}/campaigns`,
      items: campaigns.map((c) => ({
        title: c.name,
        link: `${siteUrl}/c/${c.id}`,
        description: c.description,
        pubDate: c.createdAt,
        guid: `${siteUrl}/c/${c.id}`,
        customElements: {
          'op:organization': c.org.name,
          'op:type': c.type,
          'op:memberCount': String(c._count.members),
          'op:actionCount': String(c._count.actions),
        },
      })),
    });

    return rssResponse(xml);
  } catch (error) {
    logError('RSS cause feed error', error);
    return new Response('Failed to build RSS feed', { status: 500 });
  }
}
