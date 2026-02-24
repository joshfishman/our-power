export type AgentCapabilityId =
  | 'campaign.create'
  | 'campaign.read'
  | 'campaign.update'
  | 'campaign.delete'
  | 'campaign.join'
  | 'campaign.leave'
  | 'campaignMember.updateRole'
  | 'action.create'
  | 'action.read'
  | 'action.update'
  | 'action.delete'
  | 'action.participate'
  | 'action.sendEmail'
  | 'post.create'
  | 'post.read'
  | 'post.update'
  | 'post.delete'
  | 'comment.create'
  | 'comment.update'
  | 'comment.delete'
  | 'social.follow'
  | 'social.unfollow'
  | 'social.likePost'
  | 'social.unlikePost'
  | 'social.likeComment'
  | 'social.unlikeComment'
  | 'org.create'
  | 'org.read'
  | 'org.update'
  | 'org.delete'
  | 'org.manageManagers'
  | 'user.update'
  | 'user.delete'
  | 'notification.markRead'
  | 'notification.markAllRead'
  | 'integration.dialer.start'
  | 'integration.canvass.start'
  | 'integration.civic.lookup';

export interface UserAction {
  id: string;
  domain: 'auth' | 'user' | 'social' | 'organization' | 'campaign' | 'action' | 'notifications' | 'integration';
  action: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  route: string;
  capabilityId?: AgentCapabilityId;
}

export const USER_ACTIONS: UserAction[] = [
  { id: 'auth.signIn', domain: 'auth', action: 'Sign in', method: 'POST', route: '/api/auth/[...nextauth]' },
  { id: 'auth.signUp', domain: 'auth', action: 'Sign up', method: 'POST', route: '/api/auth/[...nextauth]' },
  {
    id: 'user.updateProfile',
    domain: 'user',
    action: 'Update profile',
    method: 'PATCH',
    route: '/api/users/[userId]',
    capabilityId: 'user.update',
  },
  {
    id: 'user.delete',
    domain: 'user',
    action: 'Delete account',
    method: 'DELETE',
    route: '/api/users/[userId]',
    capabilityId: 'user.delete',
  },
  {
    id: 'user.updateLocation',
    domain: 'user',
    action: 'Update location',
    method: 'POST',
    route: '/api/me/location',
    capabilityId: 'user.update',
  },
  {
    id: 'social.follow',
    domain: 'social',
    action: 'Follow user',
    method: 'POST',
    route: '/api/users/[userId]/following',
    capabilityId: 'social.follow',
  },
  {
    id: 'social.unfollow',
    domain: 'social',
    action: 'Unfollow user',
    method: 'DELETE',
    route: '/api/users/[userId]/following/[targetUserId]',
    capabilityId: 'social.unfollow',
  },
  {
    id: 'post.create',
    domain: 'social',
    action: 'Create post',
    method: 'POST',
    route: '/api/posts',
    capabilityId: 'post.create',
  },
  {
    id: 'post.update',
    domain: 'social',
    action: 'Update post',
    method: 'PATCH',
    route: '/api/posts/[postId]',
    capabilityId: 'post.update',
  },
  {
    id: 'post.delete',
    domain: 'social',
    action: 'Delete post',
    method: 'DELETE',
    route: '/api/posts/[postId]',
    capabilityId: 'post.delete',
  },
  {
    id: 'post.like',
    domain: 'social',
    action: 'Like post',
    method: 'POST',
    route: '/api/users/[userId]/liked-posts',
    capabilityId: 'social.likePost',
  },
  {
    id: 'post.unlike',
    domain: 'social',
    action: 'Unlike post',
    method: 'DELETE',
    route: '/api/users/[userId]/liked-posts/[postId]',
    capabilityId: 'social.unlikePost',
  },
  {
    id: 'comment.create',
    domain: 'social',
    action: 'Create comment',
    method: 'POST',
    route: '/api/posts/[postId]/comments',
    capabilityId: 'comment.create',
  },
  {
    id: 'comment.reply',
    domain: 'social',
    action: 'Create reply',
    method: 'POST',
    route: '/api/comments/[commentId]/replies',
    capabilityId: 'comment.create',
  },
  {
    id: 'comment.update',
    domain: 'social',
    action: 'Update comment',
    method: 'PUT',
    route: '/api/comments/[commentId]',
    capabilityId: 'comment.update',
  },
  {
    id: 'comment.delete',
    domain: 'social',
    action: 'Delete comment',
    method: 'DELETE',
    route: '/api/comments/[commentId]',
    capabilityId: 'comment.delete',
  },
  {
    id: 'comment.like',
    domain: 'social',
    action: 'Like comment',
    method: 'POST',
    route: '/api/users/[userId]/liked-comments',
    capabilityId: 'social.likeComment',
  },
  {
    id: 'comment.unlike',
    domain: 'social',
    action: 'Unlike comment',
    method: 'DELETE',
    route: '/api/users/[userId]/liked-comments/[commentId]',
    capabilityId: 'social.unlikeComment',
  },
  {
    id: 'org.create',
    domain: 'organization',
    action: 'Create organization',
    method: 'POST',
    route: '/api/organizations',
    capabilityId: 'org.create',
  },
  {
    id: 'org.read',
    domain: 'organization',
    action: 'List organizations',
    method: 'GET',
    route: '/api/organizations',
    capabilityId: 'org.read',
  },
  {
    id: 'org.update',
    domain: 'organization',
    action: 'Update organization',
    method: 'PATCH',
    route: '/api/organizations/[id]',
    capabilityId: 'org.update',
  },
  {
    id: 'org.delete',
    domain: 'organization',
    action: 'Delete organization',
    method: 'DELETE',
    route: '/api/organizations/[id]',
    capabilityId: 'org.delete',
  },
  {
    id: 'org.addManager',
    domain: 'organization',
    action: 'Add manager',
    method: 'POST',
    route: '/api/organizations/[id]/managers',
    capabilityId: 'org.manageManagers',
  },
  {
    id: 'org.removeManager',
    domain: 'organization',
    action: 'Remove manager',
    method: 'DELETE',
    route: '/api/organizations/[id]/managers',
    capabilityId: 'org.manageManagers',
  },
  {
    id: 'campaign.create',
    domain: 'campaign',
    action: 'Create campaign',
    method: 'POST',
    route: '/api/campaigns',
    capabilityId: 'campaign.create',
  },
  {
    id: 'campaign.read',
    domain: 'campaign',
    action: 'Read campaign',
    method: 'GET',
    route: '/api/campaigns/[id]',
    capabilityId: 'campaign.read',
  },
  {
    id: 'campaign.update',
    domain: 'campaign',
    action: 'Update campaign',
    method: 'PATCH',
    route: '/api/campaigns/[id]',
    capabilityId: 'campaign.update',
  },
  {
    id: 'campaign.delete',
    domain: 'campaign',
    action: 'Delete campaign',
    method: 'DELETE',
    route: '/api/campaigns/[id]',
    capabilityId: 'campaign.delete',
  },
  {
    id: 'campaign.join',
    domain: 'campaign',
    action: 'Join campaign',
    method: 'POST',
    route: '/api/campaigns/[id]/join',
    capabilityId: 'campaign.join',
  },
  {
    id: 'campaign.leave',
    domain: 'campaign',
    action: 'Leave campaign',
    method: 'DELETE',
    route: '/api/campaigns/[id]/join',
    capabilityId: 'campaign.leave',
  },
  {
    id: 'campaign.memberRole',
    domain: 'campaign',
    action: 'Update campaign member role',
    method: 'PATCH',
    route: '/api/campaigns/[id]/members/[userId]',
    capabilityId: 'campaignMember.updateRole',
  },
  {
    id: 'action.create',
    domain: 'action',
    action: 'Create action',
    method: 'POST',
    route: '/api/actions',
    capabilityId: 'action.create',
  },
  {
    id: 'action.read',
    domain: 'action',
    action: 'Read action',
    method: 'GET',
    route: '/api/actions/[id]',
    capabilityId: 'action.read',
  },
  {
    id: 'action.update',
    domain: 'action',
    action: 'Update action',
    method: 'PATCH',
    route: '/api/actions/[id]',
    capabilityId: 'action.update',
  },
  {
    id: 'action.delete',
    domain: 'action',
    action: 'Delete action',
    method: 'DELETE',
    route: '/api/actions/[id]',
    capabilityId: 'action.delete',
  },
  {
    id: 'action.participate',
    domain: 'action',
    action: 'RSVP/complete action',
    method: 'POST',
    route: '/api/actions/[id]/participate',
    capabilityId: 'action.participate',
  },
  {
    id: 'action.sendEmail',
    domain: 'action',
    action: 'Send action email',
    method: 'POST',
    route: '/api/actions/[id]/send-email',
    capabilityId: 'action.sendEmail',
  },
  {
    id: 'integration.dialer',
    domain: 'integration',
    action: 'Start dialer',
    method: 'POST',
    route: '/api/integrations/dialer',
    capabilityId: 'integration.dialer.start',
  },
  {
    id: 'integration.canvass',
    domain: 'integration',
    action: 'Start canvass',
    method: 'POST',
    route: '/api/integrations/canvass',
    capabilityId: 'integration.canvass.start',
  },
  {
    id: 'integration.civic.lookup',
    domain: 'integration',
    action: 'Lookup civic representatives',
    method: 'GET',
    route: '/api/civic/representatives',
    capabilityId: 'integration.civic.lookup',
  },
  {
    id: 'notifications.markRead',
    domain: 'notifications',
    action: 'Mark notification read',
    method: 'PATCH',
    route: '/api/users/[userId]/notifications/[notificationId]',
    capabilityId: 'notification.markRead',
  },
  {
    id: 'notifications.markAllRead',
    domain: 'notifications',
    action: 'Mark all notifications read',
    method: 'PATCH',
    route: '/api/users/[userId]/notifications',
    capabilityId: 'notification.markAllRead',
  },
];

export interface CrudCoverage {
  entity: string;
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
  note?: string;
}

export const CRUD_COVERAGE: CrudCoverage[] = [
  { entity: 'User', create: false, read: true, update: true, delete: true, note: 'Create is auth-driven (NextAuth)' },
  { entity: 'Organization', create: true, read: true, update: true, delete: true },
  { entity: 'Campaign', create: true, read: true, update: true, delete: true },
  { entity: 'CampaignMember', create: true, read: true, update: true, delete: true },
  { entity: 'Action', create: true, read: true, update: true, delete: true },
  {
    entity: 'ActionParticipation',
    create: true,
    read: true,
    update: true,
    delete: false,
    note: 'Update used as reversible participation state',
  },
  { entity: 'Post', create: true, read: true, update: true, delete: true },
  { entity: 'Comment', create: true, read: true, update: true, delete: true },
  { entity: 'Cause', create: false, read: true, update: false, delete: false, note: 'Read-only reference/seeded data' },
];
