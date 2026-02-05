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

**For Organizations:**

- Create and manage organizations with multiple managers
- Create campaigns with cause categories, types, and status tracking
- Create actions (EVENT, PHONE, EMAIL, CANVASS) with type-specific fields
- Campaign dashboards with analytics and participation metrics
- Integration with phone banking (Scale to Win) and canvassing (Ecanvasser) tools

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
