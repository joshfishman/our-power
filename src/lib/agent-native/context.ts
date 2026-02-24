import 'server-only';

import prisma from '@/lib/prisma/prisma';
import { getScorecardSnapshot } from './scorecard';

export interface AgentRuntimeContext {
  generatedAt: string;
  userId: string | null;
  summary: {
    managedOrganizations: number;
    campaignMemberships: number;
    openActions: number;
    unreadNotifications: number;
  } | null;
  capabilitySnapshot: {
    parity: { covered: number; total: number; percentage: number };
    crud: { covered: number; total: number; percentage: number };
  };
}

export async function buildAgentRuntimeContext(userId?: string | null): Promise<AgentRuntimeContext> {
  const snapshot = getScorecardSnapshot();

  if (!userId) {
    return {
      generatedAt: new Date().toISOString(),
      userId: null,
      summary: null,
      capabilitySnapshot: {
        parity: snapshot.parity,
        crud: snapshot.crud,
      },
    };
  }

  const [managedOrganizations, campaignMemberships, openActions, unreadNotifications] = await Promise.all([
    prisma.organization.count({ where: { managers: { some: { id: userId } } } }),
    prisma.campaignMember.count({ where: { userId } }),
    prisma.actionParticipation.count({ where: { userId, willAttend: true, attended: false } }),
    prisma.activity.count({ where: { targetUserId: userId, isNotificationRead: false, isNotificationActive: true } }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    userId,
    summary: {
      managedOrganizations,
      campaignMemberships,
      openActions,
      unreadNotifications,
    },
    capabilitySnapshot: {
      parity: snapshot.parity,
      crud: snapshot.crud,
    },
  };
}
