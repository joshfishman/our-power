import { MenuBar } from '@/components/MenuBar';
import { Footer } from '@/components/Footer';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { checkRequiredFieldsArePopulated } from '@/lib/checkRequiredFieldsArePopulated';
import React from 'react';

export default async function Layout({ children }: { children: React.ReactNode }) {
  // This runs only once on the initial load of this layout
  // e.g. when the user signs in/up or on hard reload
  await checkRequiredFieldsArePopulated();

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 md:justify-center md:gap-2">
        <MenuBar />

        <ResponsiveContainer className="pt-14 md:pt-0">{children}</ResponsiveContainer>
      </div>

      <Footer />
    </div>
  );
}
