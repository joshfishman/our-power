import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// eslint-disable-next-line no-undef
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  // Append ?pgbouncer=true to disable prepared statements when using
  // Supabase's PgBouncer connection pooler (port 6543). Without this,
  // serverless environments hit "prepared statement already exists" errors.
  const connectionString = process.env.DATABASE_URL!;
  const url = new URL(connectionString);
  if (!url.searchParams.has('pgbouncer')) {
    url.searchParams.set('pgbouncer', 'true');
  }

  const adapter = new PrismaPg({
    connectionString: url.toString(),
  });
  return new PrismaClient({ adapter });
}

const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
