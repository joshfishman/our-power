import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const causes = [
  {
    name: 'Climate & Environment',
    icon: '🌍',
    color: '#22c55e',
    description: 'Climate action and environmental protection',
  },
  { name: 'Education', icon: '📚', color: '#3b82f6', description: 'Education access and reform' },
  { name: 'Healthcare', icon: '🏥', color: '#ef4444', description: 'Healthcare access and reform' },
  { name: 'Housing', icon: '🏠', color: '#f59e0b', description: 'Affordable housing and tenant rights' },
  {
    name: 'Economic Justice',
    icon: '💰',
    color: '#8b5cf6',
    description: 'Fair wages, workers rights, economic equity',
  },
  {
    name: 'Criminal Justice',
    icon: '⚖️',
    color: '#64748b',
    description: 'Criminal justice reform and police accountability',
  },
  { name: 'Immigration', icon: '🌎', color: '#06b6d4', description: 'Immigration reform and refugee rights' },
  { name: 'Voting Rights', icon: '🗳️', color: '#ec4899', description: 'Voting access and election integrity' },
  { name: 'LGBTQ+ Rights', icon: '🏳️‍🌈', color: '#a855f7', description: 'LGBTQ+ equality and protection' },
  { name: 'Racial Justice', icon: '✊', color: '#f97316', description: 'Racial equity and civil rights' },
  { name: 'Womens Rights', icon: '♀️', color: '#db2777', description: 'Gender equality and reproductive rights' },
  { name: 'Gun Safety', icon: '🔒', color: '#475569', description: 'Gun violence prevention and safety measures' },
];

async function main() {
  console.log('🌱 Starting database seed...\n');

  // Seed causes
  console.log('Creating causes...');
  for (const cause of causes) {
    await prisma.cause.upsert({
      where: { name: cause.name },
      update: cause,
      create: cause,
    });
  }
  console.log(`✅ Created ${causes.length} causes\n`);

  // Check if we have any users to make org managers
  const users = await prisma.user.findMany({ take: 1 });

  if (users.length === 0) {
    console.log('⚠️  No users found. Sign in with OAuth first to create sample orgs and campaigns.');
    console.log('   Then run: npx prisma db seed\n');
    return;
  }

  const firstUser = users[0];
  console.log(`Using user "${firstUser.name || firstUser.email}" as org manager\n`);

  // Get the created causes
  const climateCause = await prisma.cause.findUnique({ where: { name: 'Climate & Environment' } });
  const housingCause = await prisma.cause.findUnique({ where: { name: 'Housing' } });
  const educationCause = await prisma.cause.findUnique({ where: { name: 'Education' } });

  if (!climateCause || !housingCause || !educationCause) {
    console.log('❌ Failed to find causes');
    return;
  }

  // Create sample organizations
  console.log('Creating organizations...');

  const org1 = await prisma.organization.upsert({
    where: { id: 'sample-org-1' },
    update: {},
    create: {
      id: 'sample-org-1',
      name: 'Climate Action Coalition',
      description: 'A grassroots organization fighting for bold climate action and environmental justice.',
      website: 'https://example.org/climate',
      managers: { connect: { id: firstUser.id } },
    },
  });

  const org2 = await prisma.organization.upsert({
    where: { id: 'sample-org-2' },
    update: {},
    create: {
      id: 'sample-org-2',
      name: 'Housing Justice Now',
      description: 'Fighting for affordable housing and tenant protections in our community.',
      website: 'https://example.org/housing',
      managers: { connect: { id: firstUser.id } },
    },
  });

  console.log('✅ Created 2 organizations\n');

  // Create sample campaigns
  console.log('Creating campaigns...');

  const campaign1 = await prisma.campaign.upsert({
    where: { id: 'sample-campaign-1' },
    update: {},
    create: {
      id: 'sample-campaign-1',
      name: 'Clean Energy Act 2024',
      description:
        'Support the Clean Energy Act to transition our state to 100% renewable energy by 2035. This landmark legislation will create thousands of green jobs, reduce energy costs, and protect our communities from climate disasters.\n\nWe need your voice to make this happen. Join us in calling legislators, attending hearings, and spreading the word.',
      type: 'LEGISLATIVE',
      status: 'ACTIVE',
      causeId: climateCause.id,
      orgId: org1.id,
    },
  });

  const campaign2 = await prisma.campaign.upsert({
    where: { id: 'sample-campaign-2' },
    update: {},
    create: {
      id: 'sample-campaign-2',
      name: 'Rent Stabilization Ballot Measure',
      description:
        'Support the rent stabilization ballot measure to protect tenants from unfair rent increases. This measure will cap annual rent increases at 5% and provide just-cause eviction protections.\n\nJoin us in canvassing neighborhoods, phone banking voters, and getting out the vote.',
      type: 'ELECTORAL',
      status: 'ACTIVE',
      causeId: housingCause.id,
      orgId: org2.id,
    },
  });

  const campaign3 = await prisma.campaign.upsert({
    where: { id: 'sample-campaign-3' },
    update: {},
    create: {
      id: 'sample-campaign-3',
      name: 'School Board Accountability',
      description:
        'Hold our school board accountable for transparent decision-making and equitable resource allocation. We are organizing parents and community members to attend school board meetings and advocate for our students.',
      type: 'COMMUNITY',
      status: 'ACTIVE',
      causeId: educationCause.id,
      orgId: org1.id,
    },
  });

  console.log('✅ Created 3 campaigns\n');

  // Create sample actions
  console.log('Creating actions...');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(18, 0, 0, 0);

  const twoWeeks = new Date();
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  twoWeeks.setHours(9, 0, 0, 0);

  await prisma.action.upsert({
    where: { id: 'sample-action-1' },
    update: {},
    create: {
      id: 'sample-action-1',
      title: 'Call Your State Representative',
      description:
        'Call your state representative and urge them to support the Clean Energy Act. Use the script provided and log your call.',
      type: 'PHONE',
      dueDate: tomorrow,
      callScript:
        'Hello, my name is [YOUR NAME] and I am a constituent from [YOUR CITY]. I am calling to urge Representative [NAME] to support the Clean Energy Act. This legislation is critical for our states future, and I hope they will vote yes. Thank you for your time.',
      campaignId: campaign1.id,
    },
  });

  await prisma.action.upsert({
    where: { id: 'sample-action-2' },
    update: {},
    create: {
      id: 'sample-action-2',
      title: 'Community Rally at City Hall',
      description:
        'Join us for a community rally to show support for the Clean Energy Act. Bring signs, bring friends, and bring your voice!',
      type: 'EVENT',
      dueDate: nextWeek,
      eventTime: nextWeek,
      location: 'City Hall Steps, 200 N Spring St',
      locationUrl: 'https://maps.google.com/?q=200+N+Spring+St',
      campaignId: campaign1.id,
    },
  });

  await prisma.action.upsert({
    where: { id: 'sample-action-3' },
    update: {},
    create: {
      id: 'sample-action-3',
      title: 'Neighborhood Canvassing - District 5',
      description: 'Help us talk to voters in District 5 about the rent stabilization measure. Training provided.',
      type: 'CANVASS',
      dueDate: twoWeeks,
      canvassArea: 'District 5 - Downtown and surrounding neighborhoods',
      campaignId: campaign2.id,
    },
  });

  await prisma.action.upsert({
    where: { id: 'sample-action-4' },
    update: {},
    create: {
      id: 'sample-action-4',
      title: 'Attend School Board Meeting',
      description:
        'Show up to the school board meeting to demand transparency in budget decisions. We will have signs and talking points ready.',
      type: 'EVENT',
      dueDate: nextWeek,
      eventTime: nextWeek,
      location: 'School District HQ, 333 S Beaudry Ave',
      campaignId: campaign3.id,
    },
  });

  console.log('✅ Created 4 actions\n');

  console.log('🎉 Database seeded successfully!');
  console.log('\nYou can now:');
  console.log('  - Browse campaigns at /campaigns');
  console.log('  - View your organizations at /organizations');
  console.log('  - Create new campaigns and actions');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
