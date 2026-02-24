import { CRUD_COVERAGE, USER_ACTIONS } from './capabilities';

const IMPLEMENTED_CAPABILITIES = new Set([
  // Campaign
  'campaign.create',
  'campaign.read',
  'campaign.update',
  'campaign.delete',
  'campaign.join',
  'campaign.leave',
  'campaignMember.updateRole',
  // Action
  'action.create',
  'action.read',
  'action.update',
  'action.delete',
  'action.participate',
  'action.sendEmail',
  // Post
  'post.create',
  'post.read',
  'post.update',
  'post.delete',
  // Comment
  'comment.create',
  'comment.update',
  'comment.delete',
  // Social
  'social.likePost',
  // Organization
  'org.create',
  'org.read',
  'org.update',
  'org.delete',
  'org.manageManagers',
  // User
  'user.update',
  'user.delete',
  // Notifications
  'notification.markRead',
  'notification.markAllRead',
  // Integrations
  'integration.dialer.start',
  'integration.canvass.start',
  'integration.civic.lookup',
]);

export interface PercentageScore {
  covered: number;
  total: number;
  percentage: number;
}

function toScore(covered: number, total: number): PercentageScore {
  const percentage = total === 0 ? 0 : Math.round((covered / total) * 100);
  return { covered, total, percentage };
}

export function getActionParityScore(): PercentageScore {
  const mapped = USER_ACTIONS.filter((action) => action.capabilityId);
  const covered = mapped.filter(
    (action) => action.capabilityId && IMPLEMENTED_CAPABILITIES.has(action.capabilityId),
  ).length;
  return toScore(covered, USER_ACTIONS.length);
}

export function getCrudCompletenessScore(): PercentageScore {
  const fullyCrud = CRUD_COVERAGE.filter(
    (entity) => entity.create && entity.read && entity.update && entity.delete,
  ).length;
  return toScore(fullyCrud, CRUD_COVERAGE.length);
}

export function getScorecardSnapshot() {
  return {
    parity: getActionParityScore(),
    crud: getCrudCompletenessScore(),
    unsupportedActions: USER_ACTIONS.filter(
      (action) => !action.capabilityId || !IMPLEMENTED_CAPABILITIES.has(action.capabilityId),
    ),
    incompleteEntities: CRUD_COVERAGE.filter(
      (entity) => !(entity.create && entity.read && entity.update && entity.delete),
    ),
  };
}
