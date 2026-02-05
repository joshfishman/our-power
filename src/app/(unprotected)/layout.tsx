import { AppLogo } from '@/components/AppLogo';
import Link from 'next/link';
import React from 'react';
import { getServerUser } from '@/lib/getServerUser';
import { HomeMobileDropdownMenu } from './HomeMobileDropdownMenu';

function HomeNavLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <h3 className="cursor-pointer px-4 py-3 text-lg font-semibold text-muted-foreground hover:text-primary">
      <Link href={href}>{children}</Link>
    </h3>
  );
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  const [user] = await getServerUser();
  const isLoggedIn = !!user;

  return (
    <div className="flex min-h-screen w-full justify-center">
      <div className="w-full max-w-3xl gap-3 py-4 sm:py-8">
        <nav className="flex items-center justify-between px-4 sm:px-0">
          <Link href="/" title="Home page">
            <AppLogo size={36} textClass="text-2xl" />
          </Link>
          <div className="hidden gap-3 sm:flex">
            {!isLoggedIn && (
              <>
                <HomeNavLink href="/login">Login</HomeNavLink>
                <HomeNavLink href="/register">Sign Up</HomeNavLink>
              </>
            )}
          </div>
          <div className="sm:hidden">
            <HomeMobileDropdownMenu />
          </div>
        </nav>

        {children}
      </div>
    </div>
  );
}
