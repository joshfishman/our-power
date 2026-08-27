import './globals.css';
import 'swiper/css';
import 'swiper/css/zoom';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import 'react-datepicker/dist/react-datepicker.css';
import { IBM_Plex_Mono, Poppins } from 'next/font/google';
import { cn } from '@/lib/cn';
import { Providers } from '@/components/Providers';
import { auth } from '@/auth';
import React from 'react';

/* ---------------------------------------------------------------------------
 * Typography system — exactly three families, each with one job.
 *
 *   font-sans  (Poppins)         — ALL user-interface and body copy. Default.
 *   font-serif (Poppins Bold)    — editorial headings ONLY (article/essay h1-h3).
 *                                  Deliberately NOT a serif: headings use the
 *                                  same Poppins Bold as the "Our Power" logo
 *                                  wordmark, so the masthead and the page
 *                                  headings are one voice. The utility keeps
 *                                  the `font-serif` name only because ~109 call
 *                                  sites use it; every one already pairs it
 *                                  with font-bold/font-semibold.
 *   font-mono  (IBM Plex Mono)   — numeric and tabular data ONLY: money, scores,
 *                                  percentages, vote counts, IDs, dates in tables.
 *                                  Pair with `tabular-nums` so columns align.
 *
 * Never use font-mono for prose, labels, or eyebrow text — it was doing that on
 * the scorecard pages and is being unwound. See docs/design/color-scheme.md.
 * ------------------------------------------------------------------------- */
const poppins = Poppins({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata = {
  title: 'Our Power',
  description: 'A social network that powers real-world activism.',
  icons: { icon: '/logo.png', apple: '/logo.png' },
  openGraph: {
    type: 'website',
    siteName: 'Our Power',
    title: 'Our Power',
    description: 'A social network that powers real-world activism.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Our Power' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Our Power',
    description: 'A social network that powers real-world activism.',
    images: ['/og-image.png'],
  },
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en" className={cn('overflow-y-scroll', poppins.variable, ibmPlexMono.variable)}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="alternate" type="application/rss+xml" title="Our Power - Campaigns" href="/api/rss/campaigns" />
        <link rel="alternate" type="application/rss+xml" title="Our Power - Actions" href="/api/rss/actions" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.add('dark')}else if(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}})();`,
          }}
        />
        {/* Re-apply a theme saved from /styleguide's Theme Playground (this browser only). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=localStorage.getItem('op-theme-css');if(c){var s=document.getElementById('op-theme-overrides')||document.createElement('style');s.id='op-theme-overrides';s.textContent=c;document.head.appendChild(s);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={cn('bg-background font-sans text-foreground')}>
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
