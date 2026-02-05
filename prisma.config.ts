import dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Load .env.local first (higher priority), then .env as fallback
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Use DIRECT_URL for CLI operations (migrations, introspection)
    // since Supabase PgBouncer pooled connections don't support these.
    // Falls back to DATABASE_URL if DIRECT_URL is not set.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
