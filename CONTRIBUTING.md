# Contributing to Our Power

Thank you for your interest in contributing to Our Power! This guide will help you get started.

## Getting Started

1. **Fork the repository** and clone your fork locally.
2. **Install dependencies**: `npm install --legacy-peer-deps`
3. **Set up environment**: Copy `.env.example` to `.env.local` and fill in your credentials (see `ENV_SETUP.md`).
4. **Set up the database**: `npx prisma migrate dev`
5. **Seed the database**: `npx prisma db seed`
6. **Start the dev server**: `npm run dev`

## Development Workflow

### Branching

- Create a feature branch from `main`: `git checkout -b feature/your-feature`
- Use descriptive branch names: `feature/`, `fix/`, `docs/`, `refactor/`

### Code Quality

Before submitting a PR, ensure:

- **Lint passes**: `npm run lint`
- **Type-check passes**: `npm run typecheck`
- **Tests pass**: `npm run test:run`
- **Formatting is correct**: `npx prettier --check .`

Pre-commit hooks (via Husky) will automatically run lint-staged on your changes.

### Pull Requests

1. Keep PRs focused on a single concern.
2. Write a clear description of what changed and why.
3. Include screenshots for UI changes.
4. Reference any related issues.
5. Ensure CI checks pass.

## Project Structure

```
src/
  app/                  # Next.js App Router pages and API routes
    (protected)/        # Pages requiring authentication
    (unprotected)/      # Public pages
    (setup)/            # Onboarding pages
    api/                # API endpoints
  components/           # React components
    campaigns/          # Campaign-related components
    organizations/      # Organization components
    onboarding/         # Onboarding wizard
    ui/                 # Shared UI components
  hooks/                # Custom React hooks
  lib/                  # Utilities and services
    email/              # Email sending (Resend)
    integrations/       # Third-party integrations
    notifications/      # Notification system
    prisma/             # Database client and helpers
    validations/        # Zod schemas
  svg_components/       # SVG icon components
prisma/
  schema.prisma         # Database schema
  seed.ts               # Database seeding script
```

## Key Technologies

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL) + Prisma ORM
- **Auth**: NextAuth.js v5
- **Styling**: Tailwind CSS
- **State**: React Query (TanStack Query)
- **Email**: Resend
- **Testing**: Vitest, React Testing Library, Playwright

## Reporting Issues

- Use GitHub Issues to report bugs or request features.
- Include steps to reproduce bugs.
- For security issues, see `SECURITY.md`.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).
