import prisma from '@/lib/prisma/prisma';
import { buildRssFeed, rssResponse, getSiteUrl } from '@/lib/rss';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const siteUrl = getSiteUrl();
  const orgId = params.id;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, description: true },
  });

  if (!org) {
    return new Response('Organization not found', { status: 404 });
  }

  const campaigns = await prisma.campaign.findMany({
    where: {
      orgId,
      status: 'ACTIVE',
    },
    include: {
      cause: { select: { name: true } },
      _count: { select: { members: true, actions: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const xml = buildRssFeed({
    title: `Our Power - ${org.name}`,
    description: org.description || `Campaigns by ${org.name}`,
    link: `${siteUrl}/organizations/${orgId}`,
    items: campaigns.map((c) => ({
      title: c.name,
      link: `${siteUrl}/c/${c.id}`,
      description: c.description,
      pubDate: c.createdAt,
      guid: `${siteUrl}/c/${c.id}`,
      customElements: {
        'op:cause': c.cause.name,
        'op:type': c.type,
        'op:memberCount': String(c._count.members),
        'op:actionCount': String(c._count.actions),
      },
    })),
  });

  return rssResponse(xml);
}
