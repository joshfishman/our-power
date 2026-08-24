# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About This Project

**Our Power** is a Next.js social network for civic activism. Citizens browse and join campaigns, RSVP to actions, and engage with a social feed. Organizations create campaigns with actions of four types: `EVENT`, `PHONE`, `EMAIL`, and `CANVASS`. Third-party integrations include Scale to Win (phone banking) and Ecanvasser (canvassing).

## Commands

```bash
# Development
npm run dev               # Start dev server on port 3000
npm run build             # Production build
npm run lint              # ESLint
npm run typecheck         # TypeScript type check

# Testing
npm run test              # Vitest in watch mode
npm run test:run          # Single test run
npm run test:coverage     # With coverage
npm run test:e2e          # Playwright E2E

# Database
npm run prisma:deploy     # Deploy migrations
npm run prisma:seed       # Seed cause data
npm run prisma:mock       # Reset DB + create mock users
npm run prisma:studio     # Open Prisma Studio UI
```

To run a single test file: `npx vitest run src/__tests__/campaign.test.tsx`

## Architecture

### Stack

- **Framework**: Next.js 14 App Router, React 18, TypeScript
- **Database**: PostgreSQL via Supabase + Prisma ORM (client auto-generated to `src/generated/prisma/`)
- **Auth**: NextAuth.js v5 — Google, Facebook, Instagram, GitHub OAuth + email magic links (Resend)
- **Storage**: Supabase Storage (images/avatars)
- **Data fetching**: TanStack React Query v5
- **Validation**: Zod schemas (in `src/lib/validations/`)
- **UI primitives**: React Aria (Adobe accessible components)
- **Rate limiting**: Upstash Redis + `@upstash/ratelimit`
- **Monitoring**: Sentry (`instrumentation.ts`, `instrumentation-client.ts`)

### Route Groups

The App Router uses route groups to enforce layout and auth:

- `(protected)/` — requires auth; middleware redirects to `/login?from=<path>`
- `(unprotected)/` — public pages (home)
- `(auth)/` — login page; logged-in users are redirected to `/feed`
- `(info)/` — static info pages (about, terms, privacy)
- `(setup)/` — onboarding flow

Public campaign URLs use `/c/[id]` (not under `(protected)/`).

### API Routes (`src/app/api/`)

All public API routes follow a consistent pattern:

- CORS via `withCors()` / `corsOptionsResponse()` from `src/lib/api-utils.ts`
- Rate limiting via Upstash Redis (configured in `src/lib/rateLimit.ts`)
- Input validation via Zod schemas
- Auth checks: user must be org/campaign manager for write operations

### Authentication (`src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`)

- NextAuth v5 with Prisma adapter
- JWT sessions (30-day max age)
- `signIn` callback auto-assigns username from user ID on first OAuth login
- Middleware enforces route protection; embed routes (`/embed/*`) and public campaign pages (`/c/:id`) are excluded

### Data Flow Pattern

Server components fetch data directly. Client components use React Query hooks from `src/hooks/queries/` and `src/hooks/mutations/`. Data fetching utilities in `src/lib/client_data_fetching/` are used by hooks.

### Key Directories

- `src/components/ui/` — shared UI primitives (TextInput, Select, DatePicker, etc.)
- `src/components/campaigns/` — campaign and action components
- `src/lib/integrations/` — Scale to Win, Ecanvasser API clients
- `src/lib/notifications/` — campaign notification system
- `src/lib/storage/` — Supabase file upload helpers
- `src/lib/email/` — Resend email templates
- `src/contexts/` — React contexts (ReactQuery, Theme, Toast, Dialogs)

### Agent-Native Context

- Capability matrices and scoring live in `src/lib/agent-native/`.
- Runtime context payload is available at `GET /api/agent/context` and includes:
  - User summary counters (memberships, open actions, unread notifications)
  - Capability parity and CRUD score snapshot
- Scorecard report is also exposed at `GET /api/agent/scorecard`.
- Agent/tool capability docs are in:
  - `docs/agent-native/capability-matrix.md`
  - `docs/agent-native/principles-scorecard.md`

### Vision + organizational structure

This codebase is the **Our Power** Next.js platform — a generic social network for civic activism (campaigns, actions, RSVPs, social feed). Most of the codebase is the activism infrastructure.

**The Common Ground project** is a specific civic-accountability initiative built ON TOP of Our Power, sharing schema, auth, and UI primitives. It is the focus of recent work (the `src/lib/scorecard/`, `src/app/(unprotected)/scorecard/`, and `prisma/seed-scorecard.ts` surface area). Treat Common Ground as a feature/module of Our Power, not a separate app.

**Common Ground's vision** — a cross-partisan civic movement organized around five concrete legislative commitments. The pledge: _"I will only vote for candidates who commit to these five promises."_ Public accountability via a methodology-driven scorecard rating every sitting member of Congress and the California State Legislature on the same rubric, regardless of party.

**Voice register** — civic / Lincoln-Eisenhower-MLK, not progressive-advocacy. Avoid "stakeholders / intersectional / equity / progressive / MAGA." Prefer "we demand" over "we believe." Decisions in the project brief are locked unless explicitly reopened: no vouchers/charters in plank 2; no PRO Act in plank 3; fiscal honesty on Social Security in plank 4; "peace" stays in plank 5 name.

**Partnership strategy** — three-tier partner model from the partner-pitch brief (slide 08):

- **USER** (default) — open-license access to scorecard API, kitchen-table kits, action templates, methodology. No commitments expected.
- **AFFILIATE** — public endorsement + one Promise Day per quarter. Gets co-branded materials, advance news-cycle notice, partner directory listing, coordination channel.
- **ANCHOR** — staff time + seat on coordinating council. Gets strategic input, custom integrations, joint campaigns, deep coordination.

Schema: `Organization.cgPartnerTier` (enum `CgPartnerTier { USER | AFFILIATE | ANCHOR }`), `cgPartnerTierAssignedAt`, `cgPartnerCommitments` Json field. Display copy + benefits + boundaries live in `src/lib/scorecard/partner-tiers.ts`.

Boundaries that apply to ALL tiers (slide 10, "What we're not asking for"): not your list, not your donors, not your brand, not your mission, not exclusive partnership. **Coordination, not control.**

Anchor-partner targets per slide 12 — democracy reform (RepresentUs, American Promise, Issue One, Public Citizen, Unite America), civic & veterans (American Legion, IAVA, Veterans for American Ideals, Interfaith Alliance, Braver Angels), working people (AFL-CIO political dept, worker centers, state labor federations, faith-labor coalitions). Coalition spans political spectrum by design — not a progressive coalition, not a conservative coalition.

### Common Ground civic scorecard

A cross-partisan rating system for every member of Congress and every California state legislator. Same rubric applied to every legislator regardless of party. Built on top of this app's existing schema + auth.

**The five planks (federal). California is identical except Plank 5 doesn't apply (CA scores out of 20, not 25):**

1. Honest Government — corporate-PAC refusal, stock-trading ban, public financing, dark-money disclosure, lobbying cooling-off.
2. Our Children Our Future — major investment votes (CHIPS / IIJA / IRA), clean energy, science funding, environment, early childhood, infrastructure.
3. Making a Living — federal $15 minimum wage primary, plus a Republican-led wage-floor alt (Option C); wage theft / non-compete / loan-rate-cap / housing / paid leave.
4. The Care We Owe — major healthcare/veterans bill primary (IRA pricing / PACT / ACA / Medicare); plus Republican-led paid-leave alt (Option C); Medicaid protection, Social Security solvency.
5. Peace and Strength (federal only) — war powers, Pentagon audit, antitrust, State funding, trade-agreement labor protections.

**Scoring rubric per plank** (methodology v1.0, in `docs/scorecard-methodology.md` + `src/lib/scorecard/scoring.ts`):

- 5 = primary achieved + 3+ secondaries · 4 = primary + 2 sec · 3 = primary alone OR 3+ sec without primary · 2 = 2 sec without primary · 1 = 1 sec · 0 = nothing.

**Option C two-tier markers** (decided 2026-04-29): Republican-authored alternative bills count as SECONDARY markers (never primary) when (a) introduced as standalone bills with 3+ GOP cosponsors and (b) directionally aligned with the plank. Examples: Hawley's Higher Wages for American Workers Act under Plank 3; Bice-Houlahan paid leave under Plank 4. Implemented via `Marker.isRepublicanAlternative` + `parallelMarkerId` self-FK.

**Scorecard code layout:**

- `src/lib/scorecard/` — pure logic. Plank seeds (`federal-planks.ts`, `ca-planks.ts`), shared types, scoring engine (`scoring.ts`), legislative-source clients (`clients/legiscan.ts` API, `clients/legiscan-bulk.ts` on-disk fallback), calibration fixture.
- `src/app/(unprotected)/scorecard/` — public pages. `page.tsx` index, `[id]/page.tsx` legislator detail, `bills/[id]/page.tsx` per-bill issue page, `pac/page.tsx` Plank 1 PAC ranking.
- `src/app/api/scorecard/` — public read-only API: `/planks`, `/legislators/[id]`. CORS + rate-limited.
- `prisma/seed-scorecard.ts` — seeds planks + markers + bills + legislators. Idempotent; nulls publicSlugs and prunes orphan MarkerBill rows before each upsert pass to safely handle bill renumbering across re-seeds.
- `scripts/sync-marker-bills.ts` — manual CLI sync via LegiScan, `--source=api|bulk`, `--bill=…`, `--jurisdiction=…`, `--dry-run`. Refuses provisional bills.
- `scripts/backfill-legiscan-people.ts` — one-time pass that maps `Legislator.legiscanPeopleId` from the bulk dataset's `people/*.json`. Required because LegiScan roll-call vote payloads carry only `people_id` (no names), so unmapped legislators get dropped as `unmappedVoters`. Run once after seeding new legislators.
- `scripts/compute-scores.ts` — turns verified `MarkerAchievement` rows into `RepresentativeScore` rows. `--auto-verify` is SUPERSEDED by the Phase 6 admin verification UI (`/admin/scorecard/verify`) and survives only for seeding a fresh/restored DB; it bulk-flips `verifiedAt` with `verifiedBy='auto-verify-temp'` (a YELLOW machine label), never touches rows a human rejected, and logs loudly. `--publish` sets `publishedAt`. Also computes corporate-pac-refusal achievements from PacMoneyData (`verifiedBy='pac-engine'`, auto-verified at write time since FEC/Cal-Access filings are already public).
- `scripts/ingest-fec.ts` — federal PAC totals via api.open.fec.gov. One call per legislator (sorted -cycle). Caveat: counts ALL non-party PAC contributions, not strictly corporate-classified — until `CommitteeClassification` is populated, FEC_DIRECT is a broad proxy.
- `scripts/ingest-pac-data.ts` — OpenSecrets bulk path (federal). Pre-classified corporate vs labor via RealCode taxonomy.
- `scripts/ingest-cal-access.ts` — CA Cal-Access PAC. Curated-CSV path and CCDC bulk path both LIVE since v1.4. CA classifications populated (29,695 committees: 15,778 CORPORATE / 5,929 TRADE_ASSOCIATION / 4,608 LABOR / 2,748 IDEOLOGICAL / 632 PARTY) via `scripts/ingest-ca-classifications.ts`; CA PacMoneyData covers ~119 active CA legislators across 2024 + 2026 cycles with `dataSource='CAL_ACCESS_CCDC'`.

### Common Ground scorecard — external data sources

**Two unrelated data domains. Don't conflate them.**

_Legislative data_ (bills, sponsors, votes) — **LegiScan** federal + CA. API key in `LEGISCAN_API_KEY` is the primary path; `LEGISCAN_DATASET_DIR` is the bulk-dataset fallback. `LEGISCAN_SOURCE=api|bulk` selects mode (also `--source=` flag, flag wins). LegiScan does NOT cover campaign finance. The `LegislativeDataSource` interface keeps a future swap to Congress.gov + OpenStates cheap.

_Campaign finance / PAC money_ — completely separate. Three ingestion paths today:

- **`FEC_API_KEY`** (api.open.fec.gov) → `npm run scorecard:ingest-fec`. Instant key from api.data.gov/signup. 1000/hr ceiling. dataSource=FEC_DIRECT. The script also accepts `FEC_DATA_API` as an alias.
- **OpenSecrets bulk CSVs** → `npm run scorecard:ingest-pac --opensecrets-dir=./data/opensecrets/{cycle}/`. Pre-classified, methodology-strict. dataSource=OPENSECRETS_BULK. **OpenSecrets discontinued their API in April 2025; bulk CSV is the only OpenSecrets path. Don't suggest an OpenSecrets API key.**
- **Curated CSV (federal or CA)** → `npm run scorecard:ingest-pac --csv=…` (federal: bioguideId column) or `npm run scorecard:ingest-ca-pac --csv=…` (CA: openStatesId column).

If a future session sees only `LEGISCAN_API_KEY` in `.env.local`, that's intentional — the user originally believed LegiScan would suffice, then learned it doesn't carry PAC data. Do not treat the absence of an OpenSecrets credential as a setup gap.

### Common Ground scorecard — phases + status

- Phase 1 (data model + seed) ✅ shipped, applied via `prisma db push` (see migration-drift note below).
- Phase 2 (LegiScan sync, both API and bulk modes) ✅ shipped, smoke-tested end-to-end against AB-2200 / AB-1900.
- Phase 3 (PAC ingestion) ✅ shipped — federal FEC + OpenSecrets paths + CA curated CSV path + CA CCDC bulk path all live. CA CCDC bulk shipped in v1.4 with full classification coverage (29,695 committees).
- Phase 4 (scoring engine) ✅ shipped with full rubric tests.
- Phase 5 (score challenges + leaderboard) — not started.
- Phase 6 (admin verification UI) — ✅ shipped. Review queue at `/admin/scorecard/verify` (page) + `/api/admin/scorecard/verify` (GET queue, POST verify/reject/revoke) + `/api/admin/scorecard/verify/[id]` (evidence dossier). Three-tier trust model GREEN/YELLOW/RED plus a REJECTED terminal state, derived in `src/lib/scorecard/verification.ts`; append-only audit trail in `MarkerAchievementReview`. Authority is `User.platformRole` (`PlatformRole { MEMBER | SCORECARD_VERIFIER | SCORECARD_ADMIN }`), granted via `npm run scorecard:grant-role -- --email=… --role=…`; the pre-existing `SCORECARD_ADMIN_EMAILS` env allowlist still works as a bootstrap. `verifiedBy='pac-engine-v1.4'` remains a legitimate machine (YELLOW) verification — FEC/Cal-Access filings are public primary documents — and no longer overwrites a human verification on re-run.
- Phase 7 (scheduled pipeline / cron) — explicitly deferred; runs are manual via npm scripts.

Pre-119th historical bills (CHIPS H.R.4346, IIJA H.R.3684, PACT S.3373) were activated in v1.8.15-v2 with the bioguide-fallback patch (PR #52 + PR #54). The 117th Congress LegiScan bulk dataset lives in `data/US/2021-2022_117th_Congress/` (session_id 1823) and is picked up by the same `LEGISCAN_DATASET_DIR` recursive walker as the 119th dataset. Cross-session `people_id` namespace mismatch is handled by the sync resolver's bioguide-id fallback against the dataset's `people/*.json` snapshot.

### Scorecard visual theme

Brand colors: brick-red `#8B3A3A`, slate-blue navy `#2C4A5E`, parchment beige `#C8B98A`, wheat `#F5DEB3`. Voice register: civic / Lincoln-Eisenhower-MLK, not progressive-advocacy. Avoid "stakeholders / intersectional / equity / progressive / MAGA." Use "we demand" not "we believe."

Visual conventions on `/scorecard*` pages:

- Body text on white background uses `text-gray-900` which is globally overridden in `src/app/globals.css` to render as parchment beige `#C8B98A`.
- Accent panels (PAC link, Featured Issues, status notes, empty states) use `bg-[#2C4A5E]/60` with wheat text (`text-[#F5DEB3]`).
- Filter chips (jurisdiction, chamber, party): all sit on navy/60 with wheat text. Active state = brick-red border + navy/80 bg + bold weight.
- Vote-position pills keep their semantic colors (green YES / red NO / yellow NV / etc.) but with brighter borders so they read on the navy backdrop.

### Scorecard — common pitfalls + fixes

- **`legiscanPeopleId` not set on a legislator** → committee voters drop as `unmappedVoters` because LegiScan roll-call payloads have no name. Run `npm run scorecard:backfill-people` after any new legislators land.
- **`publicSlug` unique-constraint violation on re-seed** → seed releases all slugs to null at the start of each marker's bill loop before upserts, so this is handled. If you see it again, check the marker pre-pass `updateMany` block.
- **`prisma.markerBill is undefined` at runtime** → Prisma client wasn't regenerated. `npx prisma generate` (or any `db push` which auto-runs generate).
- **CA bill numbers reuse across sessions** → e.g., AB-2200 in 2023-24 is CalCare; AB-2200 in 2025-26 is "thermal curtains" (unrelated). Always pin `legiscanBillId` on CA seed entries to disambiguate. Federal numbers also reset per Congress.
- **FEC rate limit (429)** → script paces at 100ms (10 req/sec) and retries with 60s sleep on 429. If you trigger it anyway, the 1000/hr rolling-window cap reset takes ~30-60 minutes.

## Rules

- **Never modify `.env.local`** unless the user explicitly asks.
- Treat `.env.local` as sensitive; avoid reading or copying values unless required.
- **Never deploy to Vercel unless the user explicitly tells you to.** Automatic git deployments are disabled — production ships on command only. Do not run `vercel`, `vercel deploy`, `vercel --prod`, `vercel promote`, or trigger a deploy hook on your own initiative; wait for an explicit instruction to deploy. Building locally (`npm run build`) to verify is always fine.
- **Commit and push to the repo often — no need to ask.** `git commit` + `git push` are encouraged; land work in small, coherent, green commits as you go rather than holding one big batch. Pushing is NOT deploying — only the Vercel rule above gates production. Never commit secrets or `.env.local`.
- **Integrate on `dev`, never push to `main`.** All work lands on the `dev` branch (push feature branches into `dev`, or push to `dev` directly). Do NOT push to `main` — `main` is production. The path to production is `dev` → `main`. Keep an open `dev` → `main` PR; merge/deploy it only on an explicit instruction from the user.
- **When you DO deploy (on explicit instruction), always verify the build.** Before shipping, run the FULL `npm run build` on the branch HEAD (lint-staged only checks staged files; Vercel's build runs lint + typecheck over the whole tree and FAILS on errors). After deploying, open the Vercel deployment and confirm the build status is "Ready" / green — never assume it succeeded. Vercel project is `op` (production `op-pink.vercel.app`); auto git deployments are disabled, so production ships on command only.
- When reviewing or modifying forms, check for injection (SQL/NoSQL/ORM misuse), XSS (stored, reflected, DOM-based), and hardcoded secrets. Prefer minimal, targeted fixes.

## Workflow preferences

- **Plan execution:** default to **subagent-driven** (one fresh subagent per task + spec-compliance review + code-quality review). Do not switch to inline execution unless explicitly requested.
- **Branch strategy for migrations and risky changes:** always a dedicated branch + PR + Vercel-preview verification before merging. Never direct-to-`main` for dependency bumps, framework upgrades, or methodology changes that affect every legislator's score. Vercel preview env vars are configured for `DATABASE_URL`, `AUTH_*`, etc. — preview deploys boot fully.
- **Methodology-version bumps** (anything that changes how `RepresentativeScore` is computed) must trigger a recompute + spot-check of high-profile legislators on preview before merge.
- **Production deploy URL is `https://op-pink.vercel.app`** — the production deploy of `main`. When the user says "deploy" or "ship live" without further qualification, they mean merging the PR to `main` so the change reaches `op-pink.vercel.app`. Vercel preview URLs (the random `op-*.vercel.app` per-PR ones) are for verification only — never share them as "the live URL." If a PR's preview is green and the user wants it live, merge to `main`. If a PR is still verifying, share `https://op-pink.vercel.app` as the post-merge destination so the user knows where to look once it lands.
- **Always keep the methodology doc current as the methodology evolves.** `docs/scorecard-methodology.md` is the living source of truth. Any change to how scores are computed, a new data class/source, a new ingest, or a new methodology version MUST update this doc in the same change — add a row to the version table, update the relevant section, and keep the "Data sources & inventory" catalog accurate (LIVE / ON DISK / NOT HELD). Do not let the doc drift behind the code. When you finish a methodology-affecting task, updating this doc is part of "done," not a follow-up.
