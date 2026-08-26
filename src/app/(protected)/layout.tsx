import { MenuBar } from '@/components/MenuBar';
import { SiteNav } from '@/components/SiteNav';
import { Footer } from '@/components/Footer';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { checkRequiredFieldsArePopulated } from '@/lib/checkRequiredFieldsArePopulated';
import { getServerUser } from '@/lib/getServerUser';
import React from 'react';

export default async function Layout({ children }: { children: React.ReactNode }) {
  // This runs only once on the initial load of this layout
  // e.g. when the user signs in/up or on hard reload
  await checkRequiredFieldsArePopulated();
  const [user] = await getServerUser();

  return (
    <div className="flex min-h-screen flex-col">
      {/* The same nav the public side uses, so navigation does not change
          shape when a member signs in. MenuBar stays for member-only tools
          (notifications, profile, sign out). */}
      <SiteNav isLoggedIn={!!user} />
      <div className="flex flex-1 md:justify-center md:gap-2">
        {/* Member tools only. /feed is readable signed out, and a visitor must
            not be shown My Profile, Notifications or Logout. */}
        {user && <MenuBar />}

        <ResponsiveContainer className="pt-14 md:pt-0">{children}</ResponsiveContainer>
      </div>

      <Footer />
    </div>
  );
}
