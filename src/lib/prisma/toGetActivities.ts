import { FindActivityResults, GetActivities } from '@/types/definitions';
import { ActivityType } from '@/generated/prisma/client';
import prisma from './prisma';
import { convertMentionUsernamesToIds } from '../convertMentionUsernamesToIds';
import { fileNameToUrl } from '../storage/fileNameToUrl';

const deletedContent = 'This was deleted by the owner.';

function getPostIdFromActivity(type: ActivityType, sourceId: number, targetId: number | null): number | null {
  if (type === 'POST_LIKE') return targetId;
  if (type === 'POST_MENTION') return sourceId;
  return null;
}

function getCommentIdFromActivity(type: ActivityType, sourceId: number, targetId: number | null): number | null {
  if (type === 'CREATE_FOLLOW') return null;
  if (type === 'POST_LIKE' || type === 'POST_MENTION') return null;
  return type.includes('LIKE') ? targetId : sourceId;
}

export async function toGetActivities(findActivityResults: FindActivityResults): Promise<GetActivities> {
  const postIds = new Set<number>();
  const commentIds = new Set<number>();

  for (const activity of findActivityResults) {
    const postId = getPostIdFromActivity(activity.type, activity.sourceId, activity.targetId);
    const commentId = getCommentIdFromActivity(activity.type, activity.sourceId, activity.targetId);
    if (postId) postIds.add(postId);
    if (commentId) commentIds.add(commentId);
  }

  const [posts, comments] = await Promise.all([
    postIds.size
      ? prisma.post.findMany({
          where: { id: { in: Array.from(postIds) } },
          select: { id: true, content: true },
        })
      : [],
    commentIds.size
      ? prisma.comment.findMany({
          where: { id: { in: Array.from(commentIds) } },
          select: { id: true, content: true },
        })
      : [],
  ]);

  const postContentMap = new Map<number, string>();
  await Promise.all(
    posts.map(async (post) => {
      if (!post.content) {
        postContentMap.set(post.id, deletedContent);
        return;
      }
      const converted = await convertMentionUsernamesToIds({
        str: post.content,
        reverse: true,
      });
      postContentMap.set(post.id, converted.str);
    }),
  );

  const commentContentMap = new Map<number, string>();
  await Promise.all(
    comments.map(async (comment) => {
      if (!comment.content) {
        commentContentMap.set(comment.id, deletedContent);
        return;
      }
      const converted = await convertMentionUsernamesToIds({
        str: comment.content,
        reverse: true,
      });
      commentContentMap.set(comment.id, converted.str);
    }),
  );

  const notificationsPromises = findActivityResults.map(async (activity) => {
    const { type, sourceId, targetId, sourceUser, targetUser } = activity;

    // The `name` and `username` are guaranteed to be filled after the user's registration,
    // thus we can safely use non-null assertion here.
    const sourceUserWithPhotoUrl = {
      ...sourceUser,
      name: sourceUser.name!,
      username: sourceUser.username!,
      profilePhoto: fileNameToUrl(sourceUser.profilePhoto),
    };
    const targetUserWithPhotoUrl = {
      ...targetUser,
      name: targetUser.name!,
      username: targetUser.username!,
      profilePhoto: fileNameToUrl(targetUser.profilePhoto),
    };

    if (type === 'CREATE_FOLLOW') {
      return {
        ...activity,
        sourceUser: sourceUserWithPhotoUrl,
        targetUser: targetUserWithPhotoUrl,
      };
    }

    const postId = getPostIdFromActivity(type, sourceId, targetId);
    const commentId = getCommentIdFromActivity(type, sourceId, targetId);
    const content =
      postId && postContentMap.has(postId)
        ? postContentMap.get(postId)!
        : commentId && commentContentMap.has(commentId)
        ? commentContentMap.get(commentId)!
        : deletedContent;
    return {
      ...activity,
      content,
      sourceUser: sourceUserWithPhotoUrl,
      targetUser: targetUserWithPhotoUrl,
    };
  });

  return Promise.all(notificationsPromises);
}
