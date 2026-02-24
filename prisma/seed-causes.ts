import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

// Default causes for Our Power
const DEFAULT_CAUSES = [
  {
    name: 'Climate & Environment',
    icon: '🌍',
    color: '#22c55e',
    description: 'Climate action, environmental protection, and sustainability',
  },
  {
    name: 'Education',
    icon: '📚',
    color: '#3b82f6',
    description: 'Public education, school funding, and educational equity',
  },
  {
    name: 'Healthcare',
    icon: '🏥',
    color: '#ef4444',
    description: 'Healthcare access, public health, and medical research',
  },
  { name: 'Housing', icon: '🏠', color: '#f97316', description: 'Affordable housing, tenant rights, and homelessness' },
  {
    name: 'Criminal Justice',
    icon: '⚖️',
    color: '#8b5cf6',
    description: 'Police reform, prison reform, and restorative justice',
  },
  {
    name: 'Voting Rights',
    icon: '🗳️',
    color: '#06b6d4',
    description: 'Voter access, election integrity, and civic participation',
  },
  {
    name: 'Workers Rights',
    icon: '👷',
    color: '#eab308',
    description: 'Labor unions, fair wages, and workplace safety',
  },
  { name: 'Immigration', icon: '🌎', color: '#14b8a6', description: 'Immigration reform, refugee rights, and DACA' },
  {
    name: 'LGBTQ+ Rights',
    icon: '🏳️‍🌈',
    color: '#ec4899',
    description: 'LGBTQ+ equality, anti-discrimination, and transgender rights',
  },
  { name: 'Racial Justice', icon: '✊', color: '#a855f7', description: 'Racial equity, anti-racism, and civil rights' },
  { name: 'Gun Safety', icon: '🔒', color: '#64748b', description: 'Gun violence prevention and firearms regulation' },
  {
    name: 'Economic Justice',
    icon: '💰',
    color: '#84cc16',
    description: 'Income inequality, taxes, and economic policy',
  },
  {
    name: 'Reproductive Rights',
    icon: '❤️',
    color: '#f43f5e',
    description: 'Reproductive healthcare access and bodily autonomy',
  },
  {
    name: 'Government Reform',
    icon: '🏛️',
    color: '#0ea5e9',
    description: 'Campaign finance, ethics, and anti-corruption',
  },
  {
    name: 'Campaigns & Elections',
    icon: '🗳️',
    color: '#6366f1',
    description: 'Electoral campaigns, candidate support, and voter mobilization',
  },
];

async function seedCauses() {
  console.log('Seeding default causes...');

  for (const cause of DEFAULT_CAUSES) {
    await prisma.cause.upsert({
      where: { name: cause.name },
      update: cause,
      create: cause,
    });
  }

  console.log(`Seeded ${DEFAULT_CAUSES.length} causes`);
}

seedCauses()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
