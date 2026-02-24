---
name: P1 Hardening + Optimization
overview: Extend the current P1 hardening roadmap with targeted performance and framework-alignment optimizations, prioritized for low-risk quick wins first and deeper refactors second.
todos:
  - id: p1-error-contract
    content: Implement shared API error helpers and migrate core routes
    status: pending
  - id: p1-resilient-fetch
    content: Add timeout/retry fetch utility and apply to Civic + email upstream calls
    status: pending
  - id: p1-request-ids
    content: Add request correlation IDs across API responses and logs
    status: pending
  - id: p1-debug-gating
    content: Harden debug endpoints behind explicit runtime flag and guards
    status: pending
  - id: p1-prod-devtools
    content: Disable React Query Devtools in production and verify behavior
    status: pending
  - id: p1-rate-limit-order
    content: Move API rate limiting before auth/session checks on high-traffic routes
    status: pending
  - id: p1-dashboard-parallel-queries
    content: Parallelize independent dashboard stats Prisma reads to reduce API latency
    status: pending
  - id: p1-query-polling-tune
    content: Reduce notifications polling pressure and disable background tab polling
    status: pending
  - id: p1-sentry-single-init
    content: Consolidate Sentry client initialization to a single path
    status: pending
  - id: p1-react-query-stable
    content: Upgrade TanStack React Query from beta to stable v5 and validate behavior
    status: pending
  - id: p1-direct-svg-imports
    content: Replace heavy barrel imports with direct component imports for bundle hygiene
    status: pending
  - id: p1-dynamic-import-candidates
    content: Introduce dynamic imports for heavy, non-critical client UI surfaces
    status: pending
isProject: false
---

# P1 Hardening Roadmap Additions

## Objective

Add a focused optimization track to the existing P1 plan without changing the agreed hardening scope. Prioritize small, low-risk wins first, then tackle medium-effort structural improvements.

## Additions to Current Plan

### 6) API latency and abuse-surface hardening

- Move rate-limit enforcement ahead of auth/session checks in key routes, starting with `[/Users/joshuafishman/dev/op/src/app/api/dashboard/stats/route.ts](/Users/joshuafishman/dev/op/src/app/api/dashboard/stats/route.ts)`.
- Parallelize independent Prisma reads in dashboard stats using `Promise.all` after authorization is validated.
- Sweep additional high-traffic API routes for sequential await patterns and parallelize only where dependencies are independent.

### 7) Client runtime + network efficiency

- Gate dev-only tools in production in `[/Users/joshuafishman/dev/op/src/contexts/ReactQueryProvider.tsx](/Users/joshuafishman/dev/op/src/contexts/ReactQueryProvider.tsx)`.
- Tune notifications query polling in `[/Users/joshuafishman/dev/op/src/hooks/queries/useNotificationsCountQuery.ts](/Users/joshuafishman/dev/op/src/hooks/queries/useNotificationsCountQuery.ts)` by reducing interval and disabling background polling.
- Upgrade React Query packages in `[/Users/joshuafishman/dev/op/package.json](/Users/joshuafishman/dev/op/package.json)` from beta to stable v5 and validate cache/refetch behavior.

### 8) Observability initialization cleanup

- Consolidate client Sentry initialization to one source of truth across:
  - `[/Users/joshuafishman/dev/op/sentry.client.config.js](/Users/joshuafishman/dev/op/sentry.client.config.js)`
  - `[/Users/joshuafishman/dev/op/instrumentation-client.ts](/Users/joshuafishman/dev/op/instrumentation-client.ts)`
- Confirm no duplicate init or duplicate event emission in development and production-like runs.

### 9) Bundle/build hygiene

- Reduce barrel-import pressure by replacing common imports from `[/Users/joshuafishman/dev/op/src/svg_components/index.ts](/Users/joshuafishman/dev/op/src/svg_components/index.ts)` with direct component imports in hot paths first.
- Identify large non-critical client components and add `next/dynamic` loading where user-visible behavior remains stable (modals, below-the-fold sections, heavy chart/datepickers).

## Execution Order

1. Quick wins (<1h): devtools gating, polling tuning, rate-limit ordering in dashboard route.
2. Low-risk API perf: dashboard query parallelization + route-by-route sequential-await cleanup.
3. Stability work: Sentry single-init consolidation.
4. Dependency alignment: React Query stable upgrade and regression pass.
5. Bundle hygiene: direct imports and selective dynamic imports.

## Verification Additions

- Run `npm run lint` and `npm run typecheck` after each phase.
- API smoke checks:
  - dashboard stats response shape and status handling
  - rate-limited behavior correctness
- Client checks:
  - production build does not include React Query Devtools UI
  - notifications count still refreshes as expected in active tab
- Observability checks:
  - single Sentry client init path
  - no duplicate error events for one reproduced error
- Performance checks:
  - compare dashboard route timing before/after query parallelization
  - compare bundle analyzer output (or build chunk summaries) for top pages after import hygiene changes
