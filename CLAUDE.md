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

## Rules

- **Never modify `.env.local`** unless the user explicitly asks.
- Treat `.env.local` as sensitive; avoid reading or copying values unless required.
- When reviewing or modifying forms, check for injection (SQL/NoSQL/ORM misuse), XSS (stored, reflected, DOM-based), and hardcoded secrets. Prefer minimal, targeted fixes.
