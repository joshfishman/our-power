'use client';

import {
  BuildingBusinessOffice,
  Bullhorn,
  Calendar,
  ChartBar,
  Close,
  GridFeedCards,
  HamburgerMenu,
  LogOutCircle,
  NotificationBell,
  Profile,
  Search,
  TwoPeople,
} from '@/svg_components';
import { useSessionUserData } from '@/hooks/useSessionUserData';
import { useNotificationsCountQuery } from '@/hooks/queries/useNotificationsCountQuery';
import { useDialogs } from '@/hooks/useDialogs';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { AppLogo } from './AppLogo';
import { MenuBarItem } from './MenuBarItem';
import Button from './ui/Button';
import { Badge } from './ui/Badge';

export function MenuBar() {
  const [user] = useSessionUserData();
  const { data: session } = useSession();
  const username = user?.username || session?.user?.id || '';
  const { data: notificationCount } = useNotificationsCountQuery();
  const { confirm } = useDialogs();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = useCallback(() => {
    setDrawerOpen(false);
    confirm({
      title: 'Confirm Logout',
      message: 'Do you really wish to logout?',
      onConfirm: () => signOut({ callbackUrl: '/' }),
    });
  }, [confirm]);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  // All nav items
  const allItems = [
    { title: 'Feed', Icon: GridFeedCards, route: '/feed' },
    { title: 'Campaigns', Icon: Bullhorn, route: '/campaigns' },
    { title: 'My Campaigns', Icon: TwoPeople, route: '/my-campaigns' },
    { title: 'My Actions', Icon: Calendar, route: '/my-actions' },
    { title: 'Organizations', Icon: BuildingBusinessOffice, route: '/organizations' },
    { title: 'Dashboard', Icon: ChartBar, route: '/dashboard' },
    { title: 'Discover', Icon: Search, route: '/discover' },
    {
      title: 'Notifications',
      Icon: NotificationBell,
      route: '/notifications',
      badge: notificationCount,
    },
    { title: 'My Profile', Icon: Profile, route: `/${username}` },
  ];

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <div className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-[212px] md:flex-col md:items-start md:p-4">
        <Link href="/" title="Home" className="mb-4">
          <AppLogo size={48} textClass="text-3xl" />
        </Link>

        {allItems.map((item) => (
          <MenuBarItem key={item.title} {...item}>
            {item.title}
          </MenuBarItem>
        ))}

        <div className="mt-auto w-full border-t border-muted pt-4">
          <Button onPress={handleLogout} mode="subtle" expand="full" Icon={LogOutCircle}>
            Logout
          </Button>
        </div>
      </div>

      {/* ── Mobile header bar ── */}
      <div className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-sm md:hidden">
        <Link href="/feed">
          <AppLogo size={32} textClass="text-xl" />
        </Link>

        <div className="flex items-center gap-3">
          {/* Notification badge in header */}
          <button
            type="button"
            aria-label="Notifications"
            className="relative p-1"
            onClick={() => router.push('/notifications')}>
            <NotificationBell className="h-6 w-6 stroke-muted-foreground" />
            {notificationCount !== undefined && notificationCount > 0 && (
              <div className="absolute -right-1 -top-1">
                <Badge>{notificationCount}</Badge>
              </div>
            )}
          </button>

          {/* Hamburger button */}
          <button type="button" aria-label="Open menu" className="p-1" onClick={() => setDrawerOpen(true)}>
            <HamburgerMenu className="h-6 w-6 stroke-foreground" />
          </button>
        </div>
      </div>

      {/* ── Mobile slide-out drawer ── */}
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 md:hidden',
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full w-72 flex-col bg-background shadow-2xl transition-transform duration-300 ease-in-out md:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}>
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <Link href="/feed" onClick={() => setDrawerOpen(false)}>
            <AppLogo size={36} textClass="text-2xl" />
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            className="rounded-lg p-1 hover:bg-muted"
            onClick={() => setDrawerOpen(false)}>
            <Close className="h-6 w-6 stroke-foreground" />
          </button>
        </div>

        {/* Drawer nav items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {allItems.map((item) => {
            const isActive = pathname === item.route || (item.route !== '/feed' && pathname.startsWith(item.route));
            return (
              <button
                type="button"
                key={item.title}
                className={cn(
                  'flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-primary-accent/20',
                  isActive && 'border-l-4 border-primary bg-primary-accent/10 font-semibold',
                )}
                onClick={() => {
                  setDrawerOpen(false);
                  router.push(item.route);
                }}>
                <item.Icon className={cn('h-6 w-6 stroke-muted-foreground', isActive && 'stroke-primary')} />
                <span className={cn('text-base', isActive && 'text-primary')}>{item.title}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Drawer footer */}
        <div className="border-t border-border p-4">
          <button
            type="button"
            className="flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left text-destructive transition-colors hover:bg-destructive/10"
            onClick={handleLogout}>
            <LogOutCircle className="h-6 w-6 stroke-destructive" />
            <span className="text-base font-medium">Logout</span>
          </button>
        </div>
      </div>
    </>
  );
}
