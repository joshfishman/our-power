import prisma from '@/lib/prisma/prisma';
import { buildRssFeed, rssResponse, getSiteUrl } from '@/lib/rss';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const causeId = searchParams.get('causeId');
  const siteUrl = getSiteUrl();

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
}
