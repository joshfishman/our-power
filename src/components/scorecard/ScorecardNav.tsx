'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Persistent top nav for the /scorecard surface. Active-link styling mirrors
// the active filter-chip styling used across the scorecard pages
// (accent/brick border + secondary bg + bold). Colors come from the semantic
// theme tokens so the nav adapts to the active theme just like every other
// scorecard surface.

interface NavItem {
  href: string;
  label: string;
  /**
   * When true, the item is active only on an exact path match. When false,
   * it is active for the path and any descendant (e.g. /scorecard/issues/...).
   */
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/scorecard', label: 'Scorecard', exact: true },
  { href: '/scorecard/pac', label: 'PAC' },
  { href: '/scorecard/issues', label: 'Issues' },
  { href: '/scorecard/methodology', label: 'Methodology' },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function ScorecardNav() {
  const pathname = usePathname() ?? '/scorecard';

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
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded border px-3 py-1 text-foreground transition-colors ${
                    active
                      ? 'border-accent bg-secondary font-semibold'
                      : 'border border-border bg-surface shadow-sm hover:bg-secondary-accent'
                  }`}>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
