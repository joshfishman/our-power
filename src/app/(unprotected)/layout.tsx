import React from 'react';
import { getServerUser } from '@/lib/getServerUser';
import { SiteNav } from '@/components/SiteNav';

/**
 * Public shell. The nav is the SAME component the signed-in side uses, so a
 * visitor moving between the scorecard, the articles and the action hub never
 * changes navigation.
 *
 * This wrapper deliberately does NOT constrain width. It used to clamp every
 * child to max-w-3xl, which silently overrode the wider containers the
 * scorecard pages set for themselves; each page now owns its own measure
 * (max-w-site for data-dense pages, max-w-site-prose for reading).
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [user] = await getServerUser();

  return (
    <div className="flex min-h-screen w-full flex-col">
      <SiteNav isLoggedIn={!!user} />
      <div className="w-full flex-1 py-4 sm:py-8">{children}</div>
    </div>
  );
}
