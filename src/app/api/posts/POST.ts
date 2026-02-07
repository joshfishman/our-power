/**
 * POST /api/posts
 * - Allows an authenticated user to create a post.
 */
import { serverWritePost } from '@/hooks/serverWritePost';
import { enforceRateLimit } from '@/lib/api-utils';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const formData = await request.formData();
  const response = await serverWritePost({ formData, type: 'create' });
  return response instanceof Response ? response : NextResponse.json(response);
}
