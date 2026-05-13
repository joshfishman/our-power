import prisma from '@/lib/prisma/prisma';
import { buildRssFeed, rssResponse, getSiteUrl } from '@/lib/rss';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const siteUrl = getSiteUrl();
  const parsedOrgId = z.string().min(1).safeParse(params.id);
  if (!parsedOrgId.success) {
    return new Response('Invalid organization id', { status: 400 });
  }
  const orgId = parsedOrgId.data;

  try {
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
  } catch (error) {
    logError('RSS organization feed error', error);
    return new Response('Failed to build RSS feed', { status: 500 });
  }
}
