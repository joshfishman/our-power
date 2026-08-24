// Server-side resolution of the current user's scorecard-verification
// authority. The decision rules live in ./verification (pure, unit-tested);
// this module only supplies them with session and database facts.

import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { canReview, canRevoke, resolveEffectivePlatformRole, type PlatformRole, type Reviewer } from './verification';

export type { Reviewer };

/**
 * Resolve the signed-in user's effective platform role.
 *
 * Returns null when nobody is signed in, or when the account has no email —
 * a verifier must be an identifiable person, since their address is what gets
 * stamped into `MarkerAchievement.verifiedBy`.
 */
export async function getCurrentReviewer(): Promise<Reviewer | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, platformRole: true },
  });
  if (!user?.email) return null;

  const role = resolveEffectivePlatformRole({
    storedRole: user.platformRole as PlatformRole,
    email: user.email,
    allowlistRaw: process.env.SCORECARD_ADMIN_EMAILS,
  });

  return { userId: user.id, email: user.email, role };
}

/**
 * Reviewer for the current request, or null if they may not review.
 *
 * Every write path calls this server-side. Hiding the UI is not authorization.
 */
export async function requireReviewer(): Promise<Reviewer | null> {
  const reviewer = await getCurrentReviewer();
  if (!reviewer || !canReview(reviewer.role)) return null;
  return reviewer;
}

export { canReview, canRevoke };
