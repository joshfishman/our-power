/* eslint-disable import/no-extraneous-dependencies */
import { test } from '@playwright/test';
import { discoverLink, gotoStable, seedTheme, shoot, THEMES } from './visual-helpers';

/**
 * Visual baselines for one representative instance of each dynamic scorecard
 * route.
 *
 * Rather than pinning database IDs (which rot the moment the data is re-seeded)
 * we scrape a link off the corresponding index page at runtime and pick a
 * deterministic one. Routes whose slug set is defined in code rather than the
 * database (power profiles, articles) use a pinned slug instead — those are
 * stable by construction.
 *
 * If a route has no data to point at, the test SKIPS with an explicit reason.
 * If it has data but the page errors, the test FAILS — a visual suite that
 * baselines a 500 page is worse than no suite at all.
 */

type DynamicCase = {
  name: string;
  /** Index page to scrape a representative link from. */
  index: string;
  /** Matches candidate hrefs on that index page. */
  pattern: RegExp;
  /** Used when the index page yields nothing scrapeable. */
  fallback?: string;
};

const CASES: DynamicCase[] = [
  {
    name: 'scorecard-legislator-detail',
    index: '/scorecard',
    // /scorecard/<id> but not the known static children of /scorecard.
    pattern:
      /^\/scorecard\/(?!bills|pac|issues|races|race|power|methodology|candidates|articles|ghost-beneficiary)[A-Za-z0-9_-]+$/,
  },
  {
    name: 'scorecard-bill-detail',
    index: '/scorecard',
    pattern: /^\/scorecard\/bills\/[^/?#]+$/,
  },
  {
    name: 'scorecard-pac-detail',
    index: '/scorecard/pac',
    pattern: /^\/scorecard\/pac\/[^/?#]+$/,
  },
  {
    name: 'scorecard-issue-detail',
    index: '/scorecard/issues',
    pattern: /^\/scorecard\/issues\/[^/?#]+$/,
  },
  {
    name: 'scorecard-race-detail',
    index: '/scorecard/races',
    pattern: /^\/scorecard\/race\/[^/?#]+$/,
  },
  {
    name: 'scorecard-power-detail',
    index: '/scorecard/power',
    pattern: /^\/scorecard\/power\/[^/?#]+$/,
    // Power profiles are prerendered from a code-defined list, not the DB.
    fallback: '/scorecard/power/musk',
  },
  {
    name: 'scorecard-article-detail',
    index: '/scorecard/pac',
    pattern: /^\/scorecard\/articles\/[^/?#]+$/,
    // Article slugs live in src/lib/scorecard/articles.ts, not the DB.
    fallback: '/scorecard/articles/aipac-spending-in-primaries',
  },
];

test.describe('Dynamic scorecard pages', () => {
  for (const theme of THEMES) {
    test.describe(theme, () => {
      for (const { name, index, pattern, fallback } of CASES) {
        test(`${name} @${theme}`, async ({ page }, testInfo) => {
          await seedTheme(page, theme);

          const target = (await discoverLink(page, index, pattern)) ?? fallback ?? null;
          test.skip(
            target === null,
            `No ${name} available: nothing on ${index} matched ${pattern} and no pinned fallback exists.`,
          );

          await gotoStable(page, target as string);
          await shoot(page, name, theme, testInfo);
        });
      }
    });
  }
});
