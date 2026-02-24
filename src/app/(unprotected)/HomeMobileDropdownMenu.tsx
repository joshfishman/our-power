'use client';

import { DropdownMenuButton } from '@/components/ui/DropdownMenuButton';
import { HamburgerMenu } from '@/svg_components';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Key, useCallback, useEffect, useMemo, useState } from 'react';
import { Item, Section } from 'react-stately';

export function HomeMobileDropdownMenu() {
  const router = useRouter();
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const onAction = useCallback((key: Key) => router.push(key as string), [router]);

  const menuItems = useMemo(() => {
    const items: Array<{ key: string; label: string }> = [];

    if (!isLoggedIn) {
      items.push({ key: '/login', label: 'Login' });
      items.push({ key: '/register', label: 'Sign Up' });
    }

    return items;
  }, [isLoggedIn]);

  // react-aria useMenuTrigger generates IDs that differ between SSR and client,
  // causing hydration mismatches. Defer rendering until mounted.
  if (!mounted) return null;

  return (
    <DropdownMenuButton key="home-dropdown-menu" label="Home dropdown menu" onAction={onAction} Icon={HamburgerMenu}>
      <Section>
        {menuItems.map((item) => (
          <Item key={item.key}>{item.label}</Item>
        ))}
      </Section>
    </DropdownMenuButton>
  );
}
