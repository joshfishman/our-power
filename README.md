# Our Power

A social network that powers real-world activism. Our Power empowers citizens to interact and affect change in their government through coordinated citizen lobbying campaigns.

## Features

**For Citizens:**

- Browse and join activist campaigns aligned with your causes
- RSVP to and complete campaign actions (events, phone banks, emails, canvassing)
- Track your participation across campaigns and actions
- Social feed with posts, comments, likes, and follows
- Notifications for upcoming actions and campaign updates
- Customizable profile with cause preferences
- Browse the **Legislator Scorecard** to see how your representatives score on a cross-partisan civic platform

**For Organizations:**

- Create and manage organizations with multiple managers
- Create campaigns with cause categories, types, and status tracking
- Create actions (EVENT, PHONE, EMAIL, CANVASS) with type-specific fields
- Campaign dashboards with analytics and participation metrics
- Integration with phone banking (Scale to Win) and canvassing (Ecanvasser) tools

## Scorecards

Our Power ships two distinct scorecards — one is a public-facing civic feature, the other is an internal engineering health metric.

### Legislator Scorecard (public)

A non-partisan accountability tool that scores **every sitting member of Congress and the California State Legislature** against a cross-partisan civic platform — five "planks" federally, four in California. The same rubric is applied to every legislator regardless of party, and every point traces back to a public source (FEC filings, Cal-Access filings, roll-call votes, and cosponsorship records), with a human reviewing each score before it goes live.

Each legislator gets **two scores** (0–100%), and the headline number is their average:

- **PAC Score** — the share of campaign receipts that came from somewhere _other_ than corporate PACs. Refusing the money is treated as its own commitment, independent of how a legislator votes.
- **Voting Record** — the share of plank-relevant bills the legislator supported, where "support" means voting the platform-aligned way on any roll call _or_ cosponsoring the bill. Votes are de-duplicated at the bill level and gated by chamber.

The methodology is calibrated against DW-NOMINATE (the academic legislator-ideology standard) and includes a two-tier "Option C" rule so that Republican-authored alternatives moving in the same direction still earn credit. Public pages live under `/scorecard` (candidates, races, individual bills, PAC money, and a full methodology write-up), with an admin review queue for borderline bill classifications.

- Methodology: [docs/scorecard-methodology.md](docs/scorecard-methodology.md)
- Code: [src/lib/scorecard/](src/lib/scorecard/) · Pages: [src/app/(unprotected)/scorecard/](<src/app/(unprotected)/scorecard/>)

### Agent-Native Scorecard (internal)

A capability/quality scorecard that measures how "agent-native" the app is — CRUD parity, capability coverage, and adherence to a set of agent-native principles. It's surfaced at runtime via `GET /api/agent/scorecard` (and `GET /api/agent/context`), documented in [docs/agent-native/principles-scorecard.md](docs/agent-native/principles-scorecard.md), and guarded by a non-regression gate in CI so the score can't silently slip.

## Tech Stack

- **Framework**: [Next.js 14](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL) + [Prisma ORM](https://www.prisma.io/)
- **Auth**: [NextAuth.js v5](https://authjs.dev/) (Google, Facebook OAuth + email magic links)
- **Storage**: [Supabase Storage](https://supabase.com/docs/guides/storage)
- **Email**: [Resend](https://resend.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Data Fetching**: [React Query](https://tanstack.com/query)
- **UI Components**: [React Aria](https://react-spectrum.adobe.com/react-aria/)
- **Validation**: [Zod](https://zod.dev/)
- **Testing**: [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/) + [Playwright](https://playwright.dev/)
- **Deployment**: [Vercel](https://vercel.com/)

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com/) project
- OAuth credentials (Google, Facebook)
- A [Resend](https://resend.com/) API key

### Setup

```bash
# Clone the repository
git clone https://github.com/joshfishman/our-power.git
cd our-power

# Install dependencies
npm install --legacy-peer-deps

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your credentials (see ENV_SETUP.md for details)

# Set up the database
npx prisma migrate dev

# Seed with sample data
npx prisma db seed

# Start the dev server
npm run dev
```

See [ENV_SETUP.md](ENV_SETUP.md) for detailed instructions on obtaining each credential.

### Scripts

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `npm run dev`       | Start development server     |
| `npm run build`     | Production build             |
| `npm run lint`      | Run ESLint                   |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test`      | Run unit tests in watch mode |
| `npm run test:run`  | Run unit tests once          |
| `npm run test:e2e`  | Run Playwright E2E tests     |

## Project Structure

```
src/
  app/                  # Next.js App Router
    (protected)/        # Authenticated pages
    (unprotected)/      # Public pages
    api/                # API routes
  components/           # React components
    campaigns/          # Campaign and action components
    organizations/      # Organization management
    onboarding/         # User onboarding wizard
    ui/                 # Shared UI primitives
  hooks/                # Custom React hooks
  lib/                  # Utilities and services
    email/              # Resend email integration
    integrations/       # Third-party integrations
    notifications/      # Activity and notification system
    prisma/             # Database client
    storage/            # Supabase Storage helpers
    validations/        # Zod schemas
prisma/
  schema.prisma         # Database schema
  seed.ts               # Sample data seed script
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For reporting security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

Built on top of [Munia](https://github.com/leandronorcio/munia), an open-source social media app by Leandro Norcio.
