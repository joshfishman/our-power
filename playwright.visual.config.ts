// eslint-disable-next-line import/no-extraneous-dependencies
import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

/**
 * Escape hatch for environments that cannot download Playwright's pinned
 * Chromium (locked-down CI images, offline machines). Point it at a
 * Chrome-for-Testing binary. Leave it unset on a normal dev machine — mixing
 * engines across a baseline set produces wholesale font diffs.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

const reporter: ReporterDescription[] = process.env.CI
  ? [['github'], ['html', { open: 'never' }]]
  : [['list'], ['html', { open: 'never' }]];

/**
 * Visual-regression config — deliberately SEPARATE from `playwright.config.ts`.
 *
 * `npm run test:e2e` must never pick these specs up (see `testIgnore` in the
 * functional config), because screenshot suites are environment-sensitive and
 * should not be able to block CI on their own.
 *
 * Run with:   npm run test:visual
 * Rebaseline: npm run test:visual:update
 */
export default defineConfig({
  testDir: './e2e/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Screenshots should be deterministic. A retry that "fixes" a diff is hiding
  // flake rather than reporting it, so we never retry.
  retries: 0,
  // Serial-ish: a handful of workers keeps the dev server from thrashing and
  // keeps render timings (and therefore lazy-loaded content) consistent.
  workers: process.env.CI ? 1 : 2,
  reporter,
  timeout: 90_000,

  // One directory per viewport project, e.g.
  //   e2e/visual/__screenshots__/desktop/scorecard-methodology-dark.png
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',

  expect: {
    toHaveScreenshot: {
      // Per-pixel colour tolerance (0 = exact). 0.2 absorbs subpixel
      // antialiasing on text without absorbing a real colour change.
      threshold: 0.2,
      // At most 1% of the page may differ. A token/colour regression or any
      // layout shift moves far more than 1% of a full-page shot; font hinting
      // jitter moves far less.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    // Pin everything that could otherwise vary per machine and leak into a shot.
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    // `reducedMotion` is only exposed through contextOptions in Playwright 1.5x.
    contextOptions: { reducedMotion: 'reduce' },
    colorScheme: 'light', // theme is driven by the `.dark` class, not the media query
    deviceScaleFactor: 1,
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        // Full Chrome-for-Testing rather than the headless shell: the shell has
        // its own font/compositing quirks, and pinning one engine keeps
        // baselines comparable.
        channel: executablePath ? undefined : 'chromium',
        launchOptions: { executablePath },
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        // Full Chrome-for-Testing rather than the headless shell: the shell has
        // its own font/compositing quirks, and pinning one engine keeps
        // baselines comparable.
        channel: executablePath ? undefined : 'chromium',
        launchOptions: { executablePath },
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 1,
        isMobile: false, // keep the desktop Chromium engine; only the box is phone-sized
        hasTouch: true,
      },
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        // Readiness probe deliberately points at a static, DB-free page. `/`
        // 307s to /scorecard, which needs the database — if that ever errors,
        // Playwright would decide the server never came up and try to start a
        // second one on the same port (EADDRINUSE).
        url: 'http://localhost:3000/terms',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
