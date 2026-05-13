# Next.js 14 → 15 migration scope

**Status:** scoping doc. Not a plan. Not approved. Read first, decide go/no-go, then a plan can be written.

## TL;DR

Mechanical migration with one substantive risk area. Roughly half a day to one full day of focused work for this codebase, including verification. The codebase is well-positioned: App Router throughout, no Pages-router holdouts, no `next/headers` callsites, no `images.domains` config to migrate, NextAuth v5 (which Next 15 supports), and Sentry v10 (which Next 15 supports).

The substantive risk is **async dynamic APIs** — every `page.tsx`, `route.ts`, and `layout.tsx` that destructures `params` or `searchParams` must change because Next 15 makes those `Promise<...>`. Inventory below.

## What changes in Next 15

### 1. Async request APIs (this is the big one)

- `cookies()`, `headers()`, `draftMode()` → return `Promise<...>` — caller must `await`.
- Page/Layout/Route props `params` and `searchParams` → `Promise<{...}>`.
- Old sync usage still works in a deprecation window via runtime sync access, but emits warnings and breaks under strict mode/eslint config.

### 2. Caching defaults flipped

- `fetch()` no longer auto-caches. To get the old behavior, pass `cache: 'force-cache'`.
- `GET` route handlers no longer cache by default.
- Client-side Router Cache no longer applies to Pages (App router still default-caches).

### 3. React 19 support

- Next 15 supports React 19 (and recommends it). React 18.x is still allowed but with deprecation warnings.

### 4. Removed deprecations

- `images.domains` removed — must use `remotePatterns`. (We already use `remotePatterns`.)
- `runtime: 'experimental-edge'` removed — must use `runtime: 'edge'`.
- `@next/font` removed — must use built-in `next/font`. (App router default; no Pages.)

### 5. ESLint

- `eslint-config-next` needs to track Next's major. ESLint 9 flat-config support added.

## Inventory of impact on this codebase

| Surface                                   | Count                            | Mechanical fix                                                                                |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `from 'next/headers'` callsites           | **0**                            | None needed.                                                                                  |
| `params: { ... }` typed in route segments | **30** files                     | Each becomes `params: Promise<{ ... }>` + `await params` at the top of the handler/component. |
| `searchParams` usages                     | **23** files                     | Same treatment — `searchParams: Promise<{...}>` + `await searchParams`.                       |
| `fetch()` in `src/app/`                   | **36** sites                     | Audit each: if it was relying on default caching, add `cache: 'force-cache'`.                 |
| `images.domains` in `next.config.js`      | **0** (already `remotePatterns`) | None.                                                                                         |
| `@next/font` imports                      | **0**                            | None.                                                                                         |
| `runtime: 'experimental-edge'`            | **0**                            | None.                                                                                         |

The `params`/`searchParams` change is touching ~50 files but it's a textual transform. A codemod ships with Next 15:

```
npx @next/codemod@latest upgrade latest
```

Run it; review the diffs; commit. That covers most of the async-API conversion automatically. The fetch-caching question requires human judgment per call.

## Compatibility of in-flight dependencies

- **`next-auth@^5.0.0-beta.3`** — v5 beta supports Next 15 from beta.20 onward (need to bump within v5 line). Worth checking changelog for breaking changes inside v5 since beta.3.
- **`@sentry/nextjs@^10.38.0`** — supports Next 15 since v8. Already current.
- **`@tanstack/react-query@^5.90.21`** — fully compatible.
- **`react-aria@^3.27.0`** — works on React 18 and 19. No bump required to migrate Next, but if we move to React 19 we should re-check.
- **`react@^18.3.1`** — can stay on 18.3 with Next 15 (recommended is 19 but 18 keeps working with warnings).
- **`@prisma/client@7.x`** — independent of Next.

## Risks

1. **Async API conversion misses.** Codemod is good but not perfect; static + dynamic params interactions in deep client/server boundaries can slip. Mitigated by full typecheck + dev-mode sweep.
2. **Caching regressions.** 36 `fetch()` sites need to be reviewed for whether they relied on default caching. If we miss one that was implicitly cached, the user-facing surface gets a perf regression (extra latency + bandwidth) but no incorrect behavior.
3. **next-auth v5 beta interaction.** We're on beta.3 — current beta is likely later. Worth a separate compat read before pulling the trigger. Worst case: bump to v5 stable when it lands, then migrate Next.
4. **CI / build environment.** Vercel handles Next 15 transparently. If anyone runs `next build` on Node < 18.18, that'll break.

## Effort estimate

- Codemod + commit: 15 minutes.
- Manual review of codemod diffs: 30 minutes.
- Fetch-caching audit across 36 callsites: 1 hour (most won't need changes).
- next-auth v5 compat: 30 minutes of changelog reading; potentially 1-2 hours of fixes if breaking changes since beta.3.
- Full QA pass (auth flow, scorecard, feed, civic features): 1-2 hours.
- Buffer: 1 hour for unforeseen.

**Total: half a day if everything goes well, full day if there's a surprise.**

## Non-goals

- React 18 → 19 migration. Separate decision, can stay on 18 indefinitely.
- ESLint 8 → 9 flat-config migration. Separate decision.
- Turbopack adoption. Separate decision.

## Decision points to surface before writing a plan

1. **When?** Recommend doing this after the scorecard v1.2 dust settles and the parallel-Claude data ingest work is merged. Migrating mid-feature creates merge pain.
2. **next-auth bump in scope?** Yes — they should travel together since v5 beta.3 may not officially support Next 15.
3. **React 18 vs 19?** Recommend stay on 18 for this migration. React 19 is a separate decision tied to react-aria / react-query compatibility verification.
4. **Branch strategy.** A dedicated branch off main, completed and merged in one PR, is far less painful than incremental.
