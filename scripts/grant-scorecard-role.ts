// scripts/grant-scorecard-role.ts
//
// Grant or revoke platform-level scorecard verification authority.
//
// Usage:
//   npx tsx scripts/grant-scorecard-role.ts --email=someone@example.org --role=SCORECARD_VERIFIER
//   npx tsx scripts/grant-scorecard-role.ts --email=someone@example.org --role=SCORECARD_ADMIN
//   npx tsx scripts/grant-scorecard-role.ts --email=someone@example.org --role=MEMBER   # revoke
//   npx tsx scripts/grant-scorecard-role.ts --list
//
// This is the only way to add a verifier. There is deliberately no self-serve
// role UI: verification authority is a trust decision, not a setting.
//
// The SCORECARD_ADMIN_EMAILS env allowlist still works as a bootstrap path so
// the first admin can get in before any role has been granted.

import './load-env';

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const ROLES = ['MEMBER', 'SCORECARD_VERIFIER', 'SCORECARD_ADMIN'] as const;
type Role = (typeof ROLES)[number];

function parseArgs(argv: string[]): { email?: string; role?: Role; list: boolean } {
  let email: string | undefined;
  let role: Role | undefined;
  let list = false;
  for (const arg of argv.slice(2)) {
    if (arg === '--list') list = true;
    else if (arg.startsWith('--email=')) email = arg.slice('--email='.length).trim();
    else if (arg.startsWith('--role=')) {
      const value = arg.slice('--role='.length).trim().toUpperCase();
      if ((ROLES as readonly string[]).includes(value)) role = value as Role;
      else throw new Error(`Unknown role "${value}". Expected one of: ${ROLES.join(', ')}`);
    }
  }
  return { email, role, list };
}

async function main(): Promise<void> {
  const { email, role, list } = parseArgs(process.argv);

  if (list) {
    const holders = await prisma.user.findMany({
      where: { platformRole: { not: 'MEMBER' } },
      select: { email: true, name: true, platformRole: true },
      orderBy: { email: 'asc' },
    });
    if (holders.length === 0) {
      console.log('No users hold a scorecard role. The SCORECARD_ADMIN_EMAILS allowlist is the only way in.');
      return;
    }
    for (const holder of holders) {
      console.log(`${holder.platformRole.padEnd(20)} ${holder.email ?? '(no email)'} — ${holder.name ?? ''}`);
    }
    return;
  }

  if (!email || !role) {
    console.error('Usage: --email=<address> --role=<MEMBER|SCORECARD_VERIFIER|SCORECARD_ADMIN>  (or --list)');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, platformRole: true } });
  if (!user) {
    console.error(`No user with email ${email}. They must sign in once before a role can be granted.`);
    process.exitCode = 1;
    return;
  }

  if (user.platformRole === role) {
    console.log(`${email} already holds ${role}. Nothing to do.`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { platformRole: role } });
  console.log(`${email}: ${user.platformRole} → ${role}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
