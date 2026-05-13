import './globals.css';
import 'swiper/css';
import 'swiper/css/zoom';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import 'react-datepicker/dist/react-datepicker.css';
import { Poppins } from 'next/font/google';
import { cn } from '@/lib/cn';
import { Providers } from '@/components/Providers';
import { auth } from '@/auth';
import React from 'react';

const poppins = Poppins({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
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
    <html lang="en" className="overflow-y-scroll">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="alternate" type="application/rss+xml" title="Our Power - Campaigns" href="/api/rss/campaigns" />
        <link rel="alternate" type="application/rss+xml" title="Our Power - Actions" href="/api/rss/actions" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.add('dark')}else if(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}})();`,
          }}
        />
      </head>
      <body className={cn('bg-background text-foreground', poppins.className)}>
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
