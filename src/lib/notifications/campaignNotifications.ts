import 'server-only';
import prisma from '@/lib/prisma/prisma';

/**
 * Log activity when a user joins a campaign
 */
export async function logCampaignJoin({ userId, campaignId }: { userId: string; campaignId: string }) {
  // Notify campaign organizers that someone joined
  const organizers = await prisma.campaignMember.findMany({
    where: {
      campaignId,
      role: { in: ['ORGANIZER', 'ADMIN'] },
    },
    select: { userId: true },
  });

  await Promise.all(
    organizers.map((org) =>
      prisma.activity.create({
        data: {
          type: 'CAMPAIGN_JOIN',
          sourceUserId: userId,
          sourceId: parseInt(campaignId.slice(-8), 16) || 1, // Convert cuid to int for legacy compat
          targetUserId: org.userId,
        },
      }),
    ),
  );
}

/**
 * Log activity when a user RSVPs to an action
 */
export async function logActionRSVP({
  userId,
  actionId,
  campaignId,
}: {
  userId: string;
  actionId: string;
  campaignId: string;
}) {
  // Notify campaign organizers
  const organizers = await prisma.campaignMember.findMany({
    where: {
      campaignId,
      role: { in: ['ORGANIZER', 'ADMIN'] },
    },
    select: { userId: true },
  });

  await Promise.all(
    organizers.map((org) =>
      prisma.activity.create({
        data: {
          type: 'ACTION_RSVP',
          sourceUserId: userId,
          sourceId: parseInt(actionId.slice(-8), 16) || 1,
          targetUserId: org.userId,
        },
      }),
    ),
  );
}

/**
 * Log activity when a user completes an action
 */
export async function logActionCompleted({
  userId,
  actionId,
  campaignId,
}: {
  userId: string;
  actionId: string;
  campaignId: string;
}) {
  // Notify campaign organizers
  const organizers = await prisma.campaignMember.findMany({
    where: {
      campaignId,
      role: { in: ['ORGANIZER', 'ADMIN'] },
    },
    select: { userId: true },
  });

  await Promise.all(
    organizers.map((org) =>
      prisma.activity.create({
        data: {
          type: 'ACTION_COMPLETED',
          sourceUserId: userId,
          sourceId: parseInt(actionId.slice(-8), 16) || 1,
          targetUserId: org.userId,
        },
      }),
    ),
  );
}

/**
 * Create action reminder notifications for all participants
 * This should be called by a cron job
 */
export async function createActionReminders() {
  const now = new Date();
  const next24 = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const next48 = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Find actions happening in the next 48 hours
  const upcomingActions = await prisma.action.findMany({
    where: {
      isActive: true,
      dueDate: {
        gte: now,
        lt: next48,
      },
    },
    include: {
      participants: {
        where: { attended: false },
        select: { userId: true, willAttend: true },
      },
      campaign: {
        select: {
          members: {
            select: { userId: true },
          },
        },
      },
    },
  });

  const reminderPromises = upcomingActions.flatMap((action) => {
    const isDayOf = action.dueDate < next24;
    const windowStart = isDayOf
      ? new Date(action.dueDate.getTime() - 24 * 60 * 60 * 1000)
      : new Date(action.dueDate.getTime() - 48 * 60 * 60 * 1000);
    const recipients = isDayOf
      ? action.participants.filter((participant) => participant.willAttend).map((participant) => participant.userId)
      : action.campaign.members.map((member) => member.userId);

    return recipients.map(async (userId) => {
      const existingReminder = await prisma.activity.findFirst({
        where: {
          type: 'ACTION_REMINDER',
          sourceId: parseInt(action.id.slice(-8), 16) || 1,
          targetUserId: userId,
          createdAt: { gte: windowStart, lt: now },
        },
      });

      if (!existingReminder) {
        return prisma.activity.create({
          data: {
            type: 'ACTION_REMINDER',
            sourceUserId: userId, // Self-reminder
            sourceId: parseInt(action.id.slice(-8), 16) || 1,
            targetUserId: userId,
          },
        });
      }
      return null;
    });
  });

  await Promise.all(reminderPromises);

  return { remindersCreated: reminderPromises.length };
}

/**
 * Get campaign-related notifications for a user
 */
export async function getCampaignNotifications(userId: string, limit = 20) {
  return prisma.activity.findMany({
    where: {
      targetUserId: userId,
      type: {
        in: ['CAMPAIGN_JOIN', 'ACTION_RSVP', 'ACTION_COMPLETED', 'ACTION_REMINDER'],
      },
    },
    include: {
      sourceUser: {
        select: { id: true, name: true, username: true, profilePhoto: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
