import Link from 'next/link';
import prisma from '@/lib/prisma/prisma';

export interface FeedCampaign {
  id: string;
  name: string;
  description: string;
  cause: { name: string };
}
export interface FeedCause {
  id: string;
  name: string;
}

/**
 * Ways in, shown above the feed.
 *
 * These are REAL campaigns and causes read from the database, not placeholder
 * copy — a civic accountability site should not put invented organizing
 * opportunities in front of people, and there is live data to use. If a
 * category is empty the block simply does not render.
 *
 * Campaigns link to the public /c/[id] route so the cards work signed out.
 *
 * Data is fetched by `getFeedDiscovery` and passed in, rather than awaited
 * inside the component: React 18's types reject a Promise-returning component
 * used as a JSX child, so only route-level components may be async here.
 */
export async function getFeedDiscovery(): Promise<{ campaigns: FeedCampaign[]; causes: FeedCause[] }> {
  const [campaigns, causes] = await Promise.all([
    prisma.campaign.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, name: true, description: true, cause: { select: { name: true } } },
    }),
    prisma.cause.findMany({ orderBy: { name: 'asc' }, take: 8, select: { id: true, name: true } }),
  ]);
  return { campaigns, causes };
}

export function FeedDiscoveryCards({ campaigns, causes }: { campaigns: FeedCampaign[]; causes: FeedCause[] }) {
  if (campaigns.length === 0 && causes.length === 0) return null;

  return (
    <section className="mb-6 space-y-4">
      {campaigns.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-serif text-lg font-bold text-foreground">Campaigns to join</h2>
            <Link href="/campaigns" className="text-sm text-accent hover:underline">
              All campaigns &rarr;
            </Link>
          </div>
          <ul className="space-y-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/c/${campaign.id}`}
                  className="block rounded border border-border bg-card p-3 transition-colors hover:bg-surface-elevated">
                  <p className="text-xs uppercase tracking-wide text-subtle-foreground">{campaign.cause.name}</p>
                  <p className="mt-0.5 font-semibold text-foreground">{campaign.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{campaign.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {causes.length > 0 && (
        <div>
          <h2 className="mb-2 font-serif text-lg font-bold text-foreground">Causes</h2>
          <ul className="flex flex-wrap gap-2">
            {causes.map((cause) => (
              <li key={cause.id}>
                <Link
                  href={`/campaigns?cause=${encodeURIComponent(cause.id)}`}
                  className="inline-block rounded border border-border bg-surface px-3 py-1 text-sm text-foreground transition-colors hover:bg-secondary-accent">
                  {cause.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
