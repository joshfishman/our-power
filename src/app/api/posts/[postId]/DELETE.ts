/**
 * DELETE /api/posts/:postId
 * - Allows an authenticated user to delete a post.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { deleteObject } from '@/lib/storage/deleteObject';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';
import { verifyAccessToPost } from './verifyAccessToPost';

export async function DELETE(request: Request, { params }: { params: { postId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const postId = z.coerce.number().int().positive().safeParse(params.postId);
  if (!postId.success) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });
  }
  if (!(await verifyAccessToPost(postId.data))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Delete the `post` and the associated `visualMedia` from the database
  const res = await prisma.post.delete({
    select: {
      id: true,
      visualMedia: true,
    },
    where: {
      id: postId.data,
    },
  });

  // Delete the associated `visualMedia` files from the S3 bucket
  const filenames = res.visualMedia.map((m) => m.fileName);
  await Promise.all(filenames.map(deleteObject));

  return NextResponse.json({ id: res.id });
}
