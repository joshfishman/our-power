# Visual regression harness

A full-page screenshot suite that pins the current appearance of every public
page in **light and dark** themes at **desktop (1280×800)** and **mobile
(375×812)**. It exists as the safety net for the scorecard → shadcn/ui redesign:
the baselines on this branch are the *pre-refactor* truth, and any pixel the
refactor moves has to be looked at and consciously accepted.

## Layout

| Path                                    | What it is                                        |
| --------------------------------------- | ------------------------------------------------- |
| `playwright.visual.config.ts`            | Config — viewport projects, thresholds, dev server |
| `e2e/visual/static-pages.visual.spec.ts` | One test per static route × theme                  |
| `e2e/visual/dynamic-pages.visual.spec.ts`| One representative instance per dynamic route      |
| `e2e/visual/visual-helpers.ts`           | Theme seeding, page settling, masking, discovery   |
| `e2e/visual/__screenshots__/<project>/`  | Committed baseline PNGs                            |

The visual specs are **excluded from `npm run test:e2e`** (`testIgnore:
['**/visual/**']` in `playwright.config.ts`). Screenshot suites are
environment-sensitive; they must never be able to block the functional suite or
CI on their own.

## ⚠️ Baseline coverage is currently INCOMPLETE

Baselines committed on this branch cover **32 of the intended ~72 shots**. Two
environment problems blocked the rest at the time of capture; both must be
resolved and the suite rebaselined before the redesign starts, or the safety net
will not cover the pages the redesign actually touches.

**1. The Supabase database is unreachable.** Every DB-backed page returns HTTP
500 — locally *and* on production (`op-pink.vercel.app/scorecard` → 500,
`/api/scorecard/planks` → 500). The pooler reports `tenant/user
postgres.<ref> not found`, which means the Supabase project is paused or the
credentials no longer resolve. This is an infrastructure problem, not a code
problem. Affected (no baseline captured):

| Page                                 | Status                             |
| ------------------------------------ | ---------------------------------- |
| `/scorecard`                         | 500 — no baseline                  |
| `/scorecard/candidates`              | 500 — no baseline                  |
| `/scorecard/methodology/pac-classes` | 500 — no baseline                  |
| `/scorecard/pac`                     | 500 — no baseline                  |
| `/scorecard/ghost-beneficiary`       | 500 — no baseline                  |
| `/scorecard/issues`                  | 500 — no baseline                  |
| `/scorecard/races`                   | 500 — no baseline                  |
| `/scorecard/articles/[slug]`         | 500 — resolves its plank from the DB |
| `/scorecard/[id]`                    | skipped — index page is down, nothing to discover |
| `/scorecard/bills/[id]`              | skipped — ditto                    |
| `/scorecard/pac/[id]`                | skipped — ditto                    |
| `/scorecard/issues/[slug]`           | skipped — ditto                    |
| `/scorecard/race/[seat]`             | skipped — ditto                    |

Captured and verified as real rendered pages: `/scorecard/power`,
`/scorecard/power/[slug]`, `/scorecard/methodology`, `/styleguide`, `/login`,
`/terms`, `/privacy-policy`, `/developers` — 8 pages × 2 themes × 2 viewports.

**2. The baselines were captured with a non-pinned Chromium.** Playwright
1.58.1 pins Chromium revision 1208, which could not be downloaded (the
Playwright CDN is unreachable from the capture environment). They were taken
with the revision 1228 build already on disk, via
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Chrome 145 vs 146 font rendering is *probably*
identical on macOS, but that has not been verified — expect a possible
diff storm on the first run with the pinned browser.

**To finish the baseline:** restore the database, run `npx playwright install
chromium`, then:

```bash
npm run test:visual:update    # unset PLAYWRIGHT_CHROMIUM_EXECUTABLE
npm run test:visual           # twice, confirm green both times
```

Every test should then pass, with no `skipped` and no
`returned HTTP 500 — expected a rendered page`.

## Running it

```bash
npm run test:visual          # compare against committed baselines
npm run test:visual:update   # rewrite baselines
npm run test:visual:ui       # interactive runner
```

The config starts `npm run dev` on port 3000 automatically (and reuses one you
already have running). To point at a deployed environment instead:

```bash
PLAYWRIGHT_BASE_URL=https://op-pink.vercel.app npm run test:visual
```

Useful filters:

```bash
npm run test:visual -- --project=desktop
npm run test:visual -- -g "@dark"
npm run test:visual -- -g "scorecard-pac"
```

### Prerequisites

- Chromium installed: `npx playwright install chromium`. If your environment
  cannot reach the Playwright CDN, point
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at a Chrome-for-Testing binary — but be aware
  that a different Chromium build than the one the baselines were captured with
  will produce font diffs across the whole suite.
- A working `DATABASE_URL` in `.env.local`. **Most scorecard pages are
  server-rendered against the live database and return HTTP 500 when it is
  unreachable.** The suite deliberately *fails* on a 5xx rather than
  screenshotting the error page — see "Baselines are missing" below.

> Baselines are platform-sensitive. They were generated on macOS/arm64
> Chromium. Regenerating them on Linux (or in CI) will produce wholesale
> font-rendering diffs; if the suite is ever added to CI, pin it to a container
> image and rebaseline inside it once.

## What is captured

Static routes: `/scorecard`, `/scorecard/candidates`, `/scorecard/power`,
`/scorecard/methodology`, `/scorecard/methodology/pac-classes`, `/scorecard/pac`,
`/scorecard/ghost-beneficiary`, `/scorecard/issues`, `/scorecard/races`,
`/styleguide`, `/login`, `/terms`, `/privacy-policy`, `/developers`.

Dynamic routes (one representative instance each): `/scorecard/[id]`,
`/scorecard/bills/[id]`, `/scorecard/pac/[id]`, `/scorecard/issues/[slug]`,
`/scorecard/race/[seat]`, `/scorecard/power/[slug]`,
`/scorecard/articles/[slug]`.

Not captured, on purpose:

- `/about` — middleware redirects unauthenticated visitors to
  `/login?from=%2Fabout`, so the shot would duplicate the `login` baseline.
- `/` — 307s to `/scorecard`, already covered by `scorecard-index`.
- Everything under `(protected)` and `admin/` — needs an authenticated session;
  out of scope for this harness.

Dynamic instances are **discovered at runtime** by scraping the matching index
page and picking a deterministic link (shortest, then alphabetical), so the
suite follows the data instead of rotting on hard-coded IDs. Two routes whose
slugs live in code rather than the database — `/scorecard/power/[slug]` and
`/scorecard/articles/[slug]` — fall back to a pinned slug.

## Flake suppression

Everything here is deliberate; please don't remove a measure without replacing it.

- **Deterministic theme.** `localStorage.theme` is seeded in an
  `addInitScript` *before* any page script runs, so the no-flash inline script
  in `src/app/layout.tsx` picks it up on the first paint. We never click the
  ThemeSwitch — that would race and would also move the scroll position. The
  same script clears `op-theme-css`, the key the `/styleguide` Theme Playground
  persists arbitrary CSS overrides under.
- **Motion killed twice.** `reducedMotion: 'reduce'` plus Playwright's
  `animations: 'disabled'`, plus an injected stylesheet zeroing every
  `transition`/`animation` and forcing `scroll-behavior: auto`. The CSS matters
  because the app uses framer-motion, whose JS-driven motion the Playwright flag
  does not stop. The sheet is re-injected after settling in case a client render
  discarded it.
- **Dev chrome hidden.** The Next.js dev indicator (`nextjs-portal`,
  `[data-next-badge-root]`) is display-none'd — it is dev-only and moves.
- **Fonts.** `await document.fonts.ready` before every shot; web fonts change
  text metrics and would otherwise reflow every line box.
- **Images.** Every `<img>` is `decode()`d so nothing pops in mid-capture.
- **Lazy content.** The page is scrolled to the bottom one viewport at a time and
  back to the top, so anything triggered by a full-page capture's own scroll has
  already landed.
- **Network.** `networkidle` before and after settling (non-fatal — a hanging
  analytics beacon must not fail the run).
- **Pinned environment.** `locale: 'en-US'`, `timezoneId:
  'America/Los_Angeles'`, `deviceScaleFactor: 1`, `scale: 'css'`.
- **Masking.** All `<time>` elements are masked, plus anything carrying a
  `data-visual-mask` attribute — the escape hatch for a component you later find
  to be volatile. Masks paint magenta so they are obvious in a diff.
- **No retries.** A retry that "fixes" a screenshot diff is hiding flake rather
  than reporting it.

Thresholds: `threshold: 0.2` per-pixel (absorbs subpixel antialiasing on text)
and `maxDiffPixelRatio: 0.01` (at most 1% of the page). A token or colour
regression, or any layout shift, moves far more than 1% of a full-page shot;
font-hinting jitter moves far less.

## When a diff fires

1. **Look at it.** `npx playwright show-report` opens the HTML report with
   expected / actual / diff side by side. The diff image is also written to
   `test-results/<test>/`.
2. **Decide.**
   - *Unintended* — a colour, spacing or layout regression the refactor did not
     mean to cause. Fix the code, not the baseline.
   - *Legitimate* — the redesign genuinely changed this page. Accept it (below).
   - *Flake* — the same test passes on a rerun with no code change. Do **not**
     just rebaseline; find the volatile element and add `data-visual-mask` to
     it, or add a wait to `settle()` in `visual-helpers.ts`. Then say so in the
     PR.
3. **Accept a legitimate change** by rebaselining only the affected shots and
   committing the new PNGs *in the same commit as the code change that caused
   them*, so review sees cause and effect together:

   ```bash
   npm run test:visual:update -- -g "scorecard-pac"
   git add e2e/visual/__screenshots__
   ```

   Never rebaseline the whole suite to clear one diff — a blanket
   `test:visual:update` will silently absorb regressions on pages you never
   looked at.

4. **Re-run to confirm** the suite is green twice in a row before pushing.

### Baselines are missing / pages 500

If tests fail with `returned HTTP 500 — expected a rendered page`, the database
is unreachable, not the UI. Check `DATABASE_URL`/`DIRECT_URL` in `.env.local`
against the Supabase project (see the deploy notes — a rotated Supabase password
that was not synced is the usual cause, and a paused Supabase project produces
`tenant/user postgres.<ref> not found`). **Do not rebaseline while the database
is down** — you would commit screenshots of error pages and destroy the safety
net. Fix the connection, then `npm run test:visual:update` for the affected
pages.

### Adding a page

Add an entry to `SCORECARD_PAGES` / `APP_PAGES` in
`static-pages.visual.spec.ts` (or `CASES` in `dynamic-pages.visual.spec.ts`),
then `npm run test:visual:update -- -g "<name>"`. Snapshot basenames are the
filename on disk — renaming one orphans its baseline, so keep them stable.
