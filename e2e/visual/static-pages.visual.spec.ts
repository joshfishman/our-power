/* eslint-disable import/no-extraneous-dependencies */
import { test } from '@playwright/test';
import { gotoStable, seedTheme, shoot, THEMES } from './visual-helpers';

/**
 * Full-page visual baselines for every static public route, in light + dark,
 * at both viewport projects (desktop 1280x800, mobile 375x812).
 *
 * This is the pre-refactor safety net for the shadcn/ui migration of the
 * scorecard pages. See docs/design/visual-regression.md.
 */

type PageCase = {
  /** snapshot basename — keep stable, renaming orphans the baseline */
  name: string;
  path: string;
};

const SCORECARD_PAGES: PageCase[] = [
  { name: 'scorecard-index', path: '/scorecard' },
  { name: 'scorecard-candidates', path: '/scorecard/candidates' },
  { name: 'scorecard-power', path: '/scorecard/power' },
  { name: 'scorecard-methodology', path: '/scorecard/methodology' },
  { name: 'scorecard-methodology-pac-classes', path: '/scorecard/methodology/pac-classes' },
  { name: 'scorecard-pac', path: '/scorecard/pac' },
  { name: 'scorecard-ghost-beneficiary', path: '/scorecard/ghost-beneficiary' },
  { name: 'scorecard-issues', path: '/scorecard/issues' },
  { name: 'scorecard-races', path: '/scorecard/races' },
];

const APP_PAGES: PageCase[] = [
  { name: 'styleguide', path: '/styleguide' },
  { name: 'login', path: '/login' },
  { name: 'terms', path: '/terms' },
  // NOTE: the public privacy page lives at /privacy-policy (there is no
  // /privacy route in src/app/(info)/).
  { name: 'privacy-policy', path: '/privacy-policy' },
  { name: 'developers', path: '/developers' },
];

// NOTE: /about is NOT covered. It is not a public page — the middleware
// redirects unauthenticated visitors to /login?from=%2Fabout, so a screenshot
// of it would just be a duplicate of the login baseline.
// Likewise `/` 307s to /scorecard and is covered by `scorecard-index`.

function register(group: string, cases: PageCase[]) {
  test.describe(group, () => {
    for (const theme of THEMES) {
      test.describe(theme, () => {
        for (const { name, path } of cases) {
          test(`${name} @${theme}`, async ({ page }, testInfo) => {
            await seedTheme(page, theme);
            await gotoStable(page, path);
            await shoot(page, name, theme, testInfo);
          });
        }
      });
    }
  });
}

register('Scorecard pages', SCORECARD_PAGES);
register('Public app pages', APP_PAGES);
