import { AppLogo } from '@/components/AppLogo';
import { Footer } from '@/components/Footer';
import Link from 'next/link';
import React from 'react';

export default function InfoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/">
            <AppLogo size={36} textClass="text-2xl" />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/about"
              className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground">
              About
            </Link>
            <Link
              href="/terms"
              className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link
              href="/privacy-policy"
              className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link
              href="/login"
              className="ml-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
