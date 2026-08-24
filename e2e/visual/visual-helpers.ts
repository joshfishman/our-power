/* eslint-disable import/no-extraneous-dependencies */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * CSS injected into every page before the screenshot.
 *
 * Playwright's `animations: 'disabled'` already freezes CSS animations at their
 * end state, but it does NOT stop JS-driven motion (framer-motion is used
 * heavily in this app), scroll-behaviour, or the Next.js dev overlay. This
 * sheet nails all of that down.
 */
const STABILISE_CSS = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
  html { scroll-behavior: auto !important; }
  /* Next.js dev-mode indicator + error overlay portal: dev-only chrome that is
     not part of the design and moves between renders. */
  nextjs-portal,
  [data-nextjs-toast],
  #__next-build-watcher,
  [data-next-badge-root] { display: none !important; }
  /* Blinking cursors / focus rings from autofocused inputs. */
  *:focus-visible { outline: none !important; }
`;

/**
 * Seed localStorage BEFORE any page script runs.
 *
 * `src/app/layout.tsx` has an inline <head> script that reads
 * `localStorage.getItem('theme')` and adds `.dark` to <html>. Setting the key
 * via an init script is deterministic and flash-free; clicking the ThemeSwitch
 * would be racy and would also change the scroll position.
 *
 * We also clear `op-theme-css` — the /styleguide "Theme Playground" persists
 * arbitrary CSS overrides under that key, which would poison every snapshot.
 */
export async function seedTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    ([themeValue]) => {
      try {
        window.localStorage.setItem('theme', themeValue);
        window.localStorage.removeItem('op-theme-css');
      } catch {
        /* storage unavailable — the page falls back to its default theme */
      }
    },
    [theme],
  );
}

/** Elements whose content is time- or session-dependent and must be masked. */
export function volatileRegions(page: Page): Locator[] {
  return [
    // Relative timestamps ("3 days ago") and absolute dates that roll over.
    page.locator('time'),
    // Explicit opt-in escape hatch for components we later find to be volatile.
    page.locator('[data-visual-mask]'),
  ];
}

/**
 * Navigate to `path`, assert it is a real rendered page (not a 4xx/5xx or a
 * Next.js error boundary), and settle it for screenshotting.
 *
 * Throws on an error page ON PURPOSE. A visual suite that silently baselines a
 * 500 page is worse than no suite at all.
 */
export async function gotoStable(page: Page, path: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

  const status = response?.status() ?? 0;
  expect(status, `${path} returned HTTP ${status} — expected a rendered page`).toBeLessThan(400);

  await settle(page);

  // Next.js renders its error boundary with a 200 in some streaming cases, so
  // assert on the DOM too.
  const errorMarkers = await page
    .locator('text=/Application error: a (server|client)-side exception/i')
    .count();
  expect(errorMarkers, `${path} rendered a Next.js error boundary`).toBe(0);
}

/** Wait for fonts, network, images and layout to be quiet. */
export async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: STABILISE_CSS });

  await page.waitForLoadState('networkidle').catch(() => {
    /* long-poll or analytics beacon kept the connection open; the checks below
       are the real gate. */
  });

  // Web fonts change text metrics, which shifts every line box on the page.
  await page.evaluate(() => document.fonts.ready);

  // Decode every <img> so nothing pops in mid-capture.
  await page.evaluate(async () => {
    const images = Array.from(document.images);
    await Promise.all(
      images.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))),
    );
  });

  // A full-page shot scrolls the viewport; make sure lazy content triggered by
  // that scroll has landed, then return to the top.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const step = window.innerHeight;
      let y = 0;
      const tick = () => {
        window.scrollTo(0, y);
        y += step;
        if (y < document.body.scrollHeight) {
          requestAnimationFrame(tick);
        } else {
          window.scrollTo(0, 0);
          requestAnimationFrame(() => resolve());
        }
      };
      tick();
    });
  });

  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Re-inject: a client-side render after hydration can blow away the style tag.
  await page.addStyleTag({ content: STABILISE_CSS });
  await page.waitForTimeout(300);
}

/** Take the full-page snapshot under a stable, human-readable name. */
export async function shoot(page: Page, name: string, theme: Theme, testInfo: TestInfo): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
    fullPage: true,
    mask: volatileRegions(page),
    maskColor: '#FF00FF',
  });
  testInfo.annotations.push({ type: 'snapshot', description: `${name}-${theme}` });
}

/**
 * Scrape the first href matching `pattern` from an index page, so dynamic-route
 * coverage follows the data instead of hard-coded IDs that rot.
 * Returns null when the index page is unavailable or has no matching links.
 */
export async function discoverLink(page: Page, indexPath: string, pattern: RegExp): Promise<string | null> {
  try {
    const response = await page.goto(indexPath, { waitUntil: 'domcontentloaded' });
    if (!response || response.status() >= 400) return null;
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const hrefs = await page.locator('a[href]').evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLAnchorElement).getAttribute('href') || ''),
    );
    const match = hrefs
      .filter((h) => pattern.test(h))
      // Deterministic pick: shortest-then-alphabetical, so the same link wins
      // every run even if the index reorders.
      .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    return match ?? null;
  } catch {
    return null;
  }
}
