import prisma from '@/lib/prisma/prisma';
import { includeToUser } from '@/lib/prisma/includeToUser';
import { toGetUser } from '@/lib/prisma/toGetUser';
import { getServerUser } from '@/lib/getServerUser';
import { FindUserResult, GetUser } from '@/types/definitions';

export async function getProfile(username: string): Promise<GetUser | null> {
  const [currentUser] = await getServerUser();

  // Look up user by username first, then fall back to ID
  const user: FindUserResult | null = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { id: username }],
    },
    include: includeToUser(currentUser?.id),
  });

  if (!user) return null;

  // Self-healing: backfill username if missing
  if (!user.username) {
    await prisma.user.update({
      where: { id: user.id },
      data: { username: user.id },
    });
    user.username = user.id;
  }

  return toGetUser(user);
}
