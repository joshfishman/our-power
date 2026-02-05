import prisma from '@/lib/prisma/prisma';
import { getSiteUrl } from '@/lib/rss';
import { EmbedCodeGenerator } from './EmbedCodeGenerator';

export const metadata = {
  title: 'Embed Widgets | Our Power',
  description: 'Generate embeddable widget codes for Our Power campaigns and actions.',
};

export default async function EmbedPage() {
  const siteUrl = getSiteUrl();

  const campaigns = await prisma.campaign.findMany({
    where: { status: 'ACTIVE' },
    include: {
      cause: { select: { name: true, icon: true } },
      org: { select: { name: true } },
      actions: {
        where: { isActive: true },
        select: { id: true, title: true, type: true },
        orderBy: { dueDate: 'asc' },
        take: 5,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-0">
      <h1 className="mb-2 text-3xl font-bold">Embed Widgets</h1>
      <p className="mb-8 text-neutral-600 dark:text-neutral-400">
        Add Our Power campaign and action widgets to your website. Select a campaign or action below to generate an
        embed code you can copy and paste into your HTML.
      </p>

      <EmbedCodeGenerator campaigns={campaigns} siteUrl={siteUrl} />
    </div>
  );
}
