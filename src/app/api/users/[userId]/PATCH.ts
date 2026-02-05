/**
 * PATCH /api/users/:userId
 * Allows an authenticated user to update their information.
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { Prisma } from '@/generated/prisma/client';
import { getServerUser } from '@/lib/getServerUser';
import { userAboutSchema } from '@/lib/validations/userAbout';
import { toGetUser } from '@/lib/prisma/toGetUser';
import { includeToUser } from '@/lib/prisma/includeToUser';

export async function PATCH(request: Request, { params }: { params: { userId: string } }) {
  const [user] = await getServerUser();
  if (!user || user.id !== params.userId) return NextResponse.json({}, { status: 401 });

  const userAbout = await request.json();

  const validate = userAboutSchema.safeParse(userAbout);
  if (validate.success) {
    try {
      // Extract causeIds separately since it maps to a relation, not a scalar field
      const { causeIds, ...scalarData } = validate.data;

      const res = await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          ...scalarData,
          birthDate: scalarData.birthDate && new Date(scalarData.birthDate),
          // Use `set` to replace all existing cause connections with the new selection
          ...(causeIds !== undefined && {
            causes: {
              set: causeIds.map((id) => ({ id })),
            },
          }),
        },
        include: includeToUser(user.id),
      });

      return NextResponse.json(toGetUser(res));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          if (e.meta) {
            const field = (e.meta.target as string[])[0];
            const error = {
              field,
              message: `This ${field} is already taken.`,
            };
            return NextResponse.json(error, { status: 409 });
          }
        }
        return NextResponse.json({ errorMessage: 'Database (prisma) error.' }, { status: 502 });
      }
    }
  } else {
    return NextResponse.json({ errorMessage: validate.error.issues[0].message }, { status: 400 });
  }
}
