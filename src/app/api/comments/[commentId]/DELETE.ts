/**
 * DELETE /api/comments/:commentId
 * - Allows an authenticated user to delete a comment on a post.
 */

import prisma from '@/lib/prisma/prisma';
import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/getServerUser';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';
import { verifyAccessToComment } from './verifyAccessToComment';

export async function DELETE(request: Request, { params }: { params: { commentId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;
  const [user] = await getServerUser();
  const commentId = z.coerce.number().int().positive().safeParse(params.commentId);
  if (!commentId.success) {
    return NextResponse.json({ error: 'Invalid comment id' }, { status: 400 });
  }
  if (!verifyAccessToComment(commentId.data)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const res = await prisma.comment.delete({
    where: {
      id: commentId.data,
    },
  });

  // Delete the associated 'CREATE_REPLY' or 'CREATE_COMMENT' activity logs
  // If `isComment` is false, it is a reply
  const type = res?.parentId ? 'CREATE_REPLY' : 'CREATE_COMMENT';
  await prisma.activity.deleteMany({
    where: {
      type,
      sourceUserId: user?.id,
      sourceId: res.id,
      targetId: type === 'CREATE_COMMENT' ? res.postId : res.parentId,
    },
  });

  return NextResponse.json({ id: res.id });
}
