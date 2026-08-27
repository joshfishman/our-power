'use client';

import Link from 'next/link';
import { AppLogo } from '@/components/AppLogo';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

// The site's single top nav — scorecard, articles and the action hub all use
// it, so navigation is the same wherever a visitor lands. Active-link styling mirrors
// the active filter-chip styling used across the scorecard pages
// (accent/brick border + secondary bg + bold). Items with `children` render a
// click-toggle dropdown.

interface NavGrandchild {
  href: string;
  label: string;
}

interface NavChild {
  href: string;
  label: string;
  /** Third level — rendered as an indented group beneath this child. */
  children?: NavGrandchild[];
}

interface NavItem {
  href: string;
  label: string;
  /** Active only on an exact path match when true; otherwise path + descendants. */
  exact?: boolean;
  /** Extra path prefixes that also light up this item. */
  alsoActiveOn?: string[];
  /** When present, the item is a dropdown listing these links. */
  children?: NavChild[];
}

const PLANK_LINKS: NavGrandchild[] = [
  { href: '/scorecard/issues/honest-government', label: '1 · Honest Government' },
  { href: '/scorecard/issues/our-children-our-future', label: '2 · Our Children Our Future' },
  { href: '/scorecard/issues/making-a-living', label: '3 · Making a Living' },
  { href: '/scorecard/issues/the-care-we-owe', label: '4 · The Care We Owe' },
  { href: '/scorecard/issues/peace-and-strength', label: '5 · Peace and Strength' },
];

// Information architecture:
//   Scorecard          — the ranking, with PAC and the per-plank issue
//                        scorecards beneath it (planks are the third level).
//   People's Platform  — the five commitments themselves: what we ask for,
//                        before any scoring. Deliberately top level, since it
//                        is the argument the scorecard exists to serve.
//   Articles           — the written pieces.
// Methodology lives in the footer, not here: it is reference material, and it
// is not settled enough to headline the nav.
// Races is deliberately absent — the page is broken and its data does not hold.
const NAV_ITEMS: NavItem[] = [
  // Order is the argument: the platform is what we ask for, the scorecard is
  // who honours it, the articles are the evidence, the action network is what
  // you do about it.
  { href: '/scorecard/issues', label: "People's Platform", exact: true },
  {
    href: '/scorecard',
    label: 'Scorecard',
    exact: true,
    alsoActiveOn: ['/scorecard/pac', '/scorecard/issues/'],
    children: [
      { href: '/scorecard', label: 'All legislators' },
      { href: '/scorecard/pac', label: 'PAC' },
      { href: '/scorecard/issues/honest-government', label: 'Issues', children: PLANK_LINKS },
    ],
  },
  {
    href: '/scorecard/power',
    label: 'Articles',
    alsoActiveOn: ['/scorecard/power/', '/scorecard/articles/'],
    children: [
      { href: '/scorecard/power', label: 'Welfare for Billionaires' },
      { href: '/scorecard/articles/aipac-spending-in-primaries', label: 'Who Does AIPAC Support?' },
    ],
  },
  // Readable without an account, so a visitor can look around before joining.
  { href: '/feed', label: 'Action Network' },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.alsoActiveOn?.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return true;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

const ITEM_BASE = 'rounded border px-3 py-1 text-foreground transition-colors';
const activeCls = (active: boolean) =>
  active ? 'border-accent bg-secondary font-semibold' : 'border-border bg-surface shadow-sm hover:bg-secondary-accent';

export function SiteNav({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const pathname = usePathname() ?? '/scorecard';
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <nav
      aria-label="Site sections"
      className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="mx-auto flex max-w-site items-center gap-3 px-4 py-3">
        <Link href="/" className="mr-1 shrink-0" title="Home page">
          <AppLogo size={32} textClass="text-lg" />
        </Link>
        <ul className="ml-auto flex flex-wrap items-center justify-end gap-2 text-sm">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            if (!item.children) {
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`${ITEM_BASE} ${activeCls(active)}`}>
                    {item.label}
                  </Link>
                </li>
              );
            }
            const open = openMenu === item.href;
            return (
              <li key={item.href} className="relative">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-haspopup="menu"
                  onClick={() => setOpenMenu(open ? null : item.href)}
                  onBlur={() => setTimeout(() => setOpenMenu((cur) => (cur === item.href ? null : cur)), 150)}
                  className={`${ITEM_BASE} ${activeCls(active)}`}>
                  {item.label}
                  <span aria-hidden className="ml-1 text-xs opacity-70">
                    ▾
                  </span>
                </button>
                {open ? (
                  <ul
                    role="menu"
                    className="absolute left-0 z-40 mt-1 min-w-[14rem] rounded-md border border-border bg-surface p-1 shadow-lg">
                    {item.children.map((child) => {
                      const childActive = pathname === child.href;
                      return (
                        <li key={child.href} role="none">
                          <Link
                            role="menuitem"
                            href={child.href}
                            onClick={() => setOpenMenu(null)}
                            aria-current={childActive ? 'page' : undefined}
                            className={`block rounded px-3 py-1.5 text-foreground transition-colors ${
                              childActive ? 'bg-secondary font-semibold' : 'hover:bg-secondary-accent'
                            }`}>
                            {child.label}
                          </Link>
                          {child.children ? (
                            <ul role="menu" aria-label={child.label} className="ml-3 border-l border-border pl-2">
                              {child.children.map((grandchild) => {
                                const grandActive = pathname === grandchild.href;
                                return (
                                  <li key={grandchild.href} role="none">
                                    <Link
                                      role="menuitem"
                                      href={grandchild.href}
                                      onClick={() => setOpenMenu(null)}
                                      aria-current={grandActive ? 'page' : undefined}
                                      className={`block rounded px-3 py-1.5 text-sm transition-colors ${
                                        grandActive
                                          ? 'bg-secondary font-semibold text-foreground'
                                          : 'text-muted-foreground hover:bg-secondary-accent hover:text-foreground'
                                      }`}>
                                      {grandchild.label}
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!isLoggedIn && (
          // One quiet link, not two competing buttons. Signing up is reachable
          // from /login, and the nav should not push an account on a visitor
          // who is here to read.
          <Link
            href="/login"
            className="shrink-0 px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            Login
          </Link>
        )}
      </div>
    </nav>
  );
}
