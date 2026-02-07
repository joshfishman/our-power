/**
 * PATCH /api/posts/:postId
 * - Allows an authenticated user to edit a post.
 */
import { NextResponse } from 'next/server';
import { serverWritePost } from '@/hooks/serverWritePost';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function PATCH(request: Request, { params }: { params: { postId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const postId = z.coerce.number().int().positive().safeParse(params.postId);
  if (!postId.success) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });
  }

  const formData = await request.formData();
  return serverWritePost({
    formData,
    type: 'edit',
    postId: postId.data,
  });
}
