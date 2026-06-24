'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

// Persistent top nav for the /scorecard surface. Active-link styling mirrors
// the active filter-chip styling used across the scorecard pages
// (accent/brick border + secondary bg + bold). Items with `children` render a
// click-toggle dropdown.

interface NavChild {
  href: string;
  label: string;
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

const NAV_ITEMS: NavItem[] = [
  { href: '/scorecard', label: 'Scorecard', exact: true },
  { href: '/scorecard/races', label: 'Races', alsoActiveOn: ['/scorecard/race/'] },
  { href: '/scorecard/pac', label: 'PAC' },
  {
    href: '/scorecard/power',
    label: 'Welfare for Billionaires',
    alsoActiveOn: ['/scorecard/power/'],
    children: [
      { href: '/scorecard/power', label: 'All' },
      { href: '/scorecard/power/musk', label: 'Elon Musk' },
      { href: '/scorecard/power/bezos', label: 'Jeff Bezos' },
      { href: '/scorecard/power/thiel', label: 'Peter Thiel' },
      { href: '/scorecard/power/walton', label: 'Walton family' },
    ],
  },
  {
    href: '/scorecard/issues',
    label: 'Issues',
    children: [
      { href: '/scorecard/issues', label: 'All' },
      { href: '/scorecard/issues/honest-government', label: '1 · Honest Government' },
      { href: '/scorecard/issues/our-children-our-future', label: '2 · Our Children Our Future' },
      { href: '/scorecard/issues/making-a-living', label: '3 · Making a Living' },
      { href: '/scorecard/issues/the-care-we-owe', label: '4 · The Care We Owe' },
      { href: '/scorecard/issues/peace-and-strength', label: '5 · Peace and Strength' },
    ],
  },
  { href: '/scorecard/methodology', label: 'Methodology' },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.alsoActiveOn?.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return true;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

const ITEM_BASE = 'rounded border px-3 py-1 text-foreground transition-colors';
const activeCls = (active: boolean) =>
  active ? 'border-accent bg-secondary font-semibold' : 'border-border bg-surface shadow-sm hover:bg-secondary-accent';

export function ScorecardNav() {
  const pathname = usePathname() ?? '/scorecard';
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <nav
      aria-label="Scorecard sections"
      className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link
          href="/scorecard"
          className="mr-2 shrink-0 font-serif text-base font-bold text-foreground hover:text-accent">
          We the People
        </Link>
        <ul className="flex flex-wrap items-center gap-2 text-sm">
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
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
