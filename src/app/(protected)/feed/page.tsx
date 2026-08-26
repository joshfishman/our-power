import Link from 'next/link';
import { CreatePostModalLauncher } from '@/components/CreatePostModalLauncher';
import { Posts } from '@/components/Posts';
import { ThemeSwitch } from '@/components/ui/ThemeSwitch';
import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';

export const metadata = {
  title: 'Our Power | Feed',
};

export default async function Page() {
  const [user] = await getServerUser();

  // Server-side empty-feed detection. If the user follows nobody who has
  // posted AND has no posts of their own, render the empty state directly
  // and skip the client-side fetch entirely. This is the dominant cause
  // of "feed feels slow even when there's nothing in it" — the SSR
  // shipped a "Loading posts" shell, the client hydrated, fetched the
  // empty result, then re-rendered. We now render the final state on
  // first paint.
  let isEmpty = false;
  if (user) {
    const postCount = await prisma.post.count({
      where: {
        OR: [{ userId: user.id }, { user: { followers: { some: { followerId: user.id } } } }],
      },
      take: 1, // we only care about >=1; bail early
    });
    isEmpty = postCount === 0;
  }

  return (
    <div className="px-4 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-4xl font-bold">Feed</h1>
        <div>
          <ThemeSwitch />
        </div>
      </div>
      {user ? (
        <CreatePostModalLauncher />
      ) : (
        <div className="mb-4 rounded border border-border bg-surface-elevated p-4">
          <p className="text-sm text-foreground">
            You&rsquo;re reading the public feed.{' '}
            <Link href="/login" className="font-semibold text-accent underline">
              Sign in
            </Link>{' '}
            to post, follow people, and get a feed of your own.
          </p>
        </div>
      )}
      {/* Signed out: the global feed, newest first, so a visitor can look
          around before deciding to join. Signed in: their follow graph. */}
      {!user && <Posts type="public" />}
      {user && !isEmpty && <Posts type="feed" userId={user.id} />}
      {user && isEmpty && (
        <div className="mt-8 rounded border border-muted p-8 text-center">
          <p className="text-lg font-semibold">Your feed is quiet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Follow people or post something to see content here. New posts will appear automatically without a refresh.
          </p>
        </div>
      )}
    </div>
  );
}
