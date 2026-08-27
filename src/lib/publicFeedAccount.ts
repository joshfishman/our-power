import 'server-only';
import prisma from '@/lib/prisma/prisma';

/**
 * The account whose feed is published as the site's public feed.
 *
 * A visitor who is not signed in sees this account's follow-graph feed instead
 * of a bare global list, so the Action Network looks curated rather than empty.
 * The account owner has chosen to publish it.
 *
 * READ-ONLY BY CONSTRUCTION. This resolves an id used to SELECT posts for
 * display. It does not create a session, set a cookie, or influence `auth()` /
 * `getServerUser()` in any way, and no API route consults it. Every write path
 * — posting, following, liking, deleting — still authenticates the real caller,
 * so an anonymous visitor can read this feed but can never act as its owner.
 * Do not import this into a mutation path.
 */
const PUBLIC_FEED_EMAIL = 'thejoshfishman@gmail.com';

/**
 * Id of the account whose feed is published, or null if it cannot be resolved
 * (in which case callers fall back to the global public feed).
 */
export async function getPublicFeedAccountId(): Promise<string | null> {
  const account = await prisma.user.findUnique({
    where: { email: PUBLIC_FEED_EMAIL },
    select: { id: true },
  });
  return account?.id ?? null;
}
