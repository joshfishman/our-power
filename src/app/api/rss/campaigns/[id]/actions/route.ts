import prisma from '@/lib/prisma/prisma';
import { buildRssFeed, rssResponse, getSiteUrl } from '@/lib/rss';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const siteUrl = getSiteUrl();
  const parsedCampaignId = z.string().min(1).safeParse(params.id);
  if (!parsedCampaignId.success) {
    return new Response('Invalid campaign id', { status: 400 });
  }
  const campaignId = parsedCampaignId.data;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true },
    });

    if (!campaign) {
      return new Response('Campaign not found', { status: 404 });
    }

    const actions = await prisma.action.findMany({
      where: {
        campaignId,
        isActive: true,
        dueDate: { gte: new Date() },
      },
      include: {
        _count: { select: { participants: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    const xml = buildRssFeed({
      title: `Our Power - ${campaign.name} Actions`,
      description: `Upcoming actions for the "${campaign.name}" campaign`,
      link: `${siteUrl}/c/${campaignId}`,
      items: actions.map((a) => ({
        title: a.title,
        link: `${siteUrl}/c/${campaignId}`,
        description: a.description || a.title,
        pubDate: a.createdAt,
        guid: `${siteUrl}/c/${campaignId}#action-${a.id}`,
        customElements: {
          'op:actionType': a.type,
          'op:dueDate': a.dueDate.toISOString(),
          'op:participantCount': String(a._count.participants),
          ...(a.location ? { 'op:location': a.location } : {}),
        },
      })),
    });

    return rssResponse(xml);
  } catch (error) {
    logError('RSS campaign actions feed error', error);
    return new Response('Failed to build RSS feed', { status: 500 });
  }
}
