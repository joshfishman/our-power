# Agent Capability Matrix

This matrix is the source-of-truth mapping between user-visible actions and agent-addressable capabilities.

- Data source: `src/lib/agent-native/capabilities.ts`
- Goal: keep user action parity explicit and reviewable in PRs.

## Coverage Summary

- Total user actions tracked: **43**
- Actions with mapped agent capability: **41**
- Actions currently unsupported by tools: **auth.signIn**, **auth.signUp**

## Action To Capability Mapping

| Domain        | User Action          | HTTP Route                                                                    | Capability                                              |
| ------------- | -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| user          | Update profile       | `PATCH /api/users/[userId]`                                                   | `user.update`                                           |
| user          | Delete account       | `DELETE /api/users/[userId]`                                                  | `user.delete`                                           |
| social        | Create post          | `POST /api/posts`                                                             | `post.create`                                           |
| social        | Update post          | `PATCH /api/posts/[postId]`                                                   | `post.update`                                           |
| social        | Delete post          | `DELETE /api/posts/[postId]`                                                  | `post.delete`                                           |
| social        | Create comment/reply | `POST /api/posts/[postId]/comments`, `POST /api/comments/[commentId]/replies` | `comment.create`                                        |
| social        | Update comment       | `PUT /api/comments/[commentId]`                                               | `comment.update`                                        |
| social        | Delete comment       | `DELETE /api/comments/[commentId]`                                            | `comment.delete`                                        |
| social        | Follow/unfollow      | `POST/DELETE /api/users/[userId]/following...`                                | `social.follow`, `social.unfollow`                      |
| organization  | CRUD organization    | `/api/organizations` + `/api/organizations/[id]`                              | `org.create/read/update/delete`                         |
| campaign      | CRUD campaign        | `/api/campaigns` + `/api/campaigns/[id]`                                      | `campaign.create/read/update/delete`                    |
| campaign      | Join/leave           | `POST/DELETE /api/campaigns/[id]/join`                                        | `campaign.join`, `campaign.leave`                       |
| campaign      | Update member role   | `PATCH /api/campaigns/[id]/members/[userId]`                                  | `campaignMember.updateRole`                             |
| action        | CRUD action          | `/api/actions` + `/api/actions/[id]`                                          | `action.create/read/update/delete`                      |
| action        | RSVP/complete        | `POST /api/actions/[id]/participate`                                          | `action.participate`                                    |
| action        | Send email           | `POST /api/actions/[id]/send-email`                                           | `action.sendEmail`                                      |
| integration   | Civic lookup         | `GET /api/civic/representatives`                                              | `integration.civic.lookup`                              |
| integration   | Start dialer/canvass | `POST /api/integrations/dialer`, `POST /api/integrations/canvass`             | `integration.dialer.start`, `integration.canvass.start` |
| notifications | Mark read/all read   | `PATCH /api/users/[userId]/notifications...`                                  | `notification.markRead`, `notification.markAllRead`     |

## Maintenance Rules

1. Any new UI mutation route must add an entry in `USER_ACTIONS`.
2. Any new agent capability must be represented in `AgentCapabilityId`.
3. PRs that add user actions without capability mapping should be marked parity-regressing.
