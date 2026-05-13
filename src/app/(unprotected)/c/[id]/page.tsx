import prisma from '@/lib/prisma/prisma';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { getSiteUrl } from '@/lib/rss';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: {
      cause: { select: { name: true } },
      org: { select: { name: true } },
    },
  });

  if (!campaign) {
    return { title: 'Campaign Not Found | Our Power' };
  }

  const siteUrl = getSiteUrl();
  const description = campaign.description.slice(0, 160);

  return {
    title: `${campaign.name} | Our Power`,
    description,
    openGraph: {
      title: campaign.name,
      description,
      url: `${siteUrl}/c/${campaign.id}`,
      siteName: 'Our Power',
      type: 'website',
      ...(campaign.imageUrl ? { images: [{ url: campaign.imageUrl }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: campaign.name,
      description,
    },
    alternates: {
      types: {
        'application/rss+xml': `${siteUrl}/api/rss/campaigns/${campaign.id}/actions`,
      },
    },
  };
}

const ACTION_TYPE_ICONS: Record<string, string> = {
  EVENT: '📍',
  PHONE: '📞',
  EMAIL: '✉️',
  CANVASS: '🚶',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  EVENT: 'Event',
  PHONE: 'Call in Support',
  EMAIL: 'Email in Support',
  CANVASS: 'Canvassing',
};

export default async function PublicCampaignPage(props: Props) {
  const params = await props.params;
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id, status: 'ACTIVE' },
    include: {
      cause: { select: { id: true, name: true, icon: true, color: true } },
      org: { select: { id: true, name: true, logoUrl: true } },
      actions: {
        where: { isActive: true, dueDate: { gte: new Date() } },
        orderBy: { dueDate: 'asc' },
        take: 10,
        include: { _count: { select: { participants: true } } },
      },
      _count: { select: { members: true, actions: true } },
    },
  });

  if (!campaign) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-0">
      {/* Cause badge */}
      <div className="mb-4 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: campaign.cause.color || '#0284c7' }}>
          {campaign.cause.icon} {campaign.cause.name}
        </span>
        <span className="text-sm text-neutral-500">by {campaign.org.name}</span>
      </div>

      {/* Campaign header */}
      {campaign.imageUrl && (
        <div className="relative mb-6 h-48 overflow-hidden rounded-xl sm:h-64">
          <Image
            src={campaign.imageUrl}
            alt={campaign.name}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
          />
        </div>
      )}

      <h1 className="mb-3 text-3xl font-bold">{campaign.name}</h1>

      <div className="mb-6 flex items-center gap-4 text-sm text-neutral-500">
        <span>{campaign._count.members} members</span>
        <span>{campaign._count.actions} actions</span>
        <span className="capitalize">{campaign.type.toLowerCase().replace('_', ' ')}</span>
      </div>

      {/* Description */}
      <div className="mb-8 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{campaign.description}</div>

      {/* CTA */}
      <div className="mb-10">
        <Link
          href={`/login?from=/campaigns/${campaign.id}`}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-sky-700">
          Join This Campaign
        </Link>
      </div>

      {/* Upcoming actions */}
      {campaign.actions.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-bold">Upcoming Actions</h2>
          <div className="space-y-4">
            {campaign.actions.map((action) => (
              <div key={action.id} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-lg">{ACTION_TYPE_ICONS[action.type] || '📋'}</span>
                  <h3 className="font-semibold">{action.title}</h3>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
                  <span>{ACTION_TYPE_LABELS[action.type] || action.type}</span>
                  <span>{format(action.dueDate, 'MMM d, yyyy')}</span>
                  {action.eventTime && <span>at {format(action.eventTime, 'h:mm a')}</span>}
                  {action.location && <span>{action.location}</span>}
                  <span>{action._count.participants} participants</span>
                </div>
                {action.description && (
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {action.description.slice(0, 200)}
                    {action.description.length > 200 ? '...' : ''}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* CTA at bottom */}
          <div className="mt-6 text-center">
            <Link
              href={`/login?from=/campaigns/${campaign.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-sky-700">
              Sign Up to Take Action
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
