import Link from 'next/link';

const footerLinks = [
  {
    heading: 'Platform',
    links: [
      { label: 'Feed', href: '/feed' },
      { label: 'Campaigns', href: '/campaigns' },
      { label: 'Organizations', href: '/organizations' },
      { label: 'Discover', href: '/discover' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy-policy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
  {
    heading: 'Project',
    links: [
      // Methodology lives here rather than in the scorecard nav: it is
      // reference material, and it is not settled enough to headline the nav.
      { label: 'Methodology', href: '/scorecard/methodology' },
      { label: 'About', href: '/about' },
      { label: 'GitHub', href: 'https://github.com/joshfishman/our-power', external: true },
      { label: 'Report a Bug', href: 'https://github.com/joshfishman/our-power/issues', external: true },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto max-w-site-prose px-4 py-8">
        {/* Link columns */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {footerLinks.map((group) => (
            <div key={group.heading}>
              <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {group.heading}
              </h4>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            &copy; {year} Our Power. Open source under the{' '}
            <a
              href="https://github.com/joshfishman/our-power/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground">
              MIT License
            </a>
            .
          </p>
          <p className="text-xs text-muted-foreground">Built for the people, by the people.</p>
        </div>
      </div>
    </footer>
  );
}
