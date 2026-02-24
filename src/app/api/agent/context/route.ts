import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { enforceRateLimit } from '@/lib/api-utils';
import { buildAgentRuntimeContext } from '@/lib/agent-native/context';

// GET /api/agent/context - Dynamic context payload for agent sessions
export async function GET(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const context = await buildAgentRuntimeContext(userId);
  return NextResponse.json(context);
}
