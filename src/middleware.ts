import authConfig from '@/auth.config';
import NextAuth from 'next-auth';

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
  // Skip API, Next internals, and any static asset file (anything ending in a
  // known asset extension) — the previous `.png|.jpg` lookahead only matched
  // paths STARTING with those, so /logo.png fell through to auth and 307'd.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif)$).*)'],
};
