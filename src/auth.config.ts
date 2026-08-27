import type { NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Facebook from 'next-auth/providers/facebook';
import Google from 'next-auth/providers/google';
import Instagram from 'next-auth/providers/instagram';
import { NextResponse } from 'next/server';

export default {
  providers: [Google, Facebook, Instagram, GitHub],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const { pathname, search } = nextUrl;
      const isLoggedIn = !!auth?.user;
      const isOnAuthPage = pathname.startsWith('/login') || pathname.startsWith('/register');

      // '/feed' is public on purpose: a visitor can read the global feed and
      // look around before signing up. Posting, following and the personal
      // follow-graph feed all still require a session — the page renders the
      // signed-out variant, and /api/posts/public serves only what a post card
      // shows. Every other member surface stays gated.
      const unProtectedPages = ['/terms', '/privacy-policy', '/developers', '/scorecard', '/styleguide', '/feed']; // Add more here if needed
      // Dynamic route patterns that should be public
      const unProtectedPatterns = [
        /^\/c\/[^/]+$/, // Public campaign detail pages at /c/:id
        /^\/embed/, // Embed pages
        /^\/scorecard(\/.*)?$/, // Public scorecard index and detail pages
      ];
      const isOnUnprotectedPage =
        pathname === '/' || // The root page '/' is also an unprotected page
        unProtectedPages.some((page) => pathname.startsWith(page)) ||
        unProtectedPatterns.some((pattern) => pattern.test(pathname));
      const isProtectedPage = !isOnUnprotectedPage;

      if (isOnAuthPage) {
        // Redirect to /feed, if logged in and is on an auth page
        if (isLoggedIn) return NextResponse.redirect(new URL('/feed', nextUrl));
      } else if (isProtectedPage) {
        // Redirect to /login, if not logged in but is on a protected page
        if (!isLoggedIn) {
          const from = encodeURIComponent(pathname + search); // The /login page shall then use this `from` param as a `callbackUrl` upon successful sign in
          return NextResponse.redirect(new URL(`/login?from=${from}`, nextUrl));
        }
      }

      // Don't redirect if on an unprotected page, or if logged in and is on a protected page
      return true;
    },
  },
} satisfies NextAuthConfig;
