import prisma from '@/lib/prisma/prisma';
import { buildRssFeed, rssResponse, getSiteUrl } from '@/lib/rss';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const siteUrl = getSiteUrl();
  const causeId = params.id;

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
}
