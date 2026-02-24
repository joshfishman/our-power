'use client';

import BuildingBusinessOffice from '@/svg_components/BuildingBusinessOffice';
import Bullhorn from '@/svg_components/Bullhorn';
import Calendar from '@/svg_components/Calendar';
import ChartBar from '@/svg_components/ChartBar';
import Close from '@/svg_components/Close';
import GridFeedCards from '@/svg_components/GridFeedCards';
import HamburgerMenu from '@/svg_components/HamburgerMenu';
import LogOutCircle from '@/svg_components/LogOutCircle';
import NotificationBell from '@/svg_components/NotificationBell';
import Profile from '@/svg_components/Profile';
import Search from '@/svg_components/Search';
import TwoPeople from '@/svg_components/TwoPeople';
import { useSessionUserData } from '@/hooks/useSessionUserData';
import { useNotificationsCountQuery } from '@/hooks/queries/useNotificationsCountQuery';
import { useDialogs } from '@/hooks/useDialogs';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { AppLogo } from './AppLogo';
import Button from './ui/Button';
import { Badge } from './ui/Badge';

export function MenuBar() {
  const [user] = useSessionUserData();
  const { data: session } = useSession();
  const username = user?.username || session?.user?.id || '';
  const { data: notificationCount } = useNotificationsCountQuery();
  const { confirm } = useDialogs();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Prevent hydration mismatch: react-aria useButton and session-dependent
  // content can differ between SSR and client. Render a placeholder until mounted.
  if (!mounted) {
    return (
      <>
        {/* Placeholder matching desktop sidebar dimensions */}
        <div className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-[212px] md:flex-col md:items-start md:p-4" />
        {/* Placeholder matching mobile header dimensions */}
        <div className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-sm md:hidden" />
      </>
    );
  }

  return (
    <>
      {/* ── Desktop sidebar — two-column compact grid ── */}
      <div className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-[280px] md:flex-col md:items-start md:p-4">
        <Link href="/" title="Home" className="mb-4">
          <AppLogo size={48} textClass="text-3xl" />
        </Link>

        <div className="grid w-full grid-cols-2 gap-1">
          {allItems.map((item) => {
            const isActive = pathname === item.route || (item.route !== '/feed' && pathname.startsWith(item.route));
            return (
              <button
                type="button"
                key={item.title}
                className={cn(
                  'group relative flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-center transition-colors hover:bg-primary-accent/20',
                  isActive && 'bg-primary-accent/10',
                )}
                onClick={() => router.push(item.route)}>
                <div className="relative">
                  <item.Icon
                    className={cn('h-5 w-5 stroke-muted-foreground transition-colors', isActive && 'stroke-primary')}
                  />
                  {item.badge !== undefined && item.badge > 0 && (
                    <div className="absolute -right-2 -top-1.5">
                      <Badge>{item.badge}</Badge>
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs leading-tight text-muted-foreground transition-colors',
                    isActive && 'font-semibold text-primary',
                  )}>
                  {item.title}
                </span>
                {isActive && (
                  <div className="absolute bottom-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-t-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>

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

      {/* ── Mobile slide-out drawer — two-column grid ── */}
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

        {/* Drawer nav items — two-column grid */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="grid grid-cols-2 gap-1">
            {allItems.map((item) => {
              const isActive = pathname === item.route || (item.route !== '/feed' && pathname.startsWith(item.route));
              return (
                <button
                  type="button"
                  key={item.title}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition-colors hover:bg-primary-accent/20',
                    isActive && 'bg-primary-accent/10',
                  )}
                  onClick={() => {
                    setDrawerOpen(false);
                    router.push(item.route);
                  }}>
                  <div className="relative">
                    <item.Icon className={cn('h-6 w-6 stroke-muted-foreground', isActive && 'stroke-primary')} />
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-xs leading-tight',
                      isActive ? 'font-semibold text-primary' : 'text-muted-foreground',
                    )}>
                    {item.title}
                  </span>
                </button>
              );
            })}
          </div>
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
