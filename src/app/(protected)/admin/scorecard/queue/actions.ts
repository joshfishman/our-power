'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma/prisma';
import { isScorecardAdmin } from '@/lib/scorecard/admin-auth';

export async function saveReview(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const { allowed, email } = await isScorecardAdmin();
  if (!allowed) return { ok: false, error: 'Not authorized' };

  const voteId = String(formData.get('voteId') ?? '');
  const planksRaw = String(formData.get('plankNumbers') ?? '');
  const alignedRaw = String(formData.get('alignedPosition') ?? '');

  if (!voteId) return { ok: false, error: 'Missing voteId' };

  const plankNumbers = planksRaw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);

  const alignedPosition = alignedRaw === 'YES' || alignedRaw === 'NO' ? alignedRaw : null;
  const isScorable = plankNumbers.length > 0 && alignedPosition !== null;

  try {
    await prisma.rollCallVote.update({
      where: { id: voteId },
      data: {
        plankNumbers,
        alignedPosition,
        classificationConfidence: 1.0, // human-reviewed = max confidence
        classificationSource: 'auto-then-human',
        reviewedAt: new Date(),
        reviewedBy: email ?? 'unknown-admin',
        isScorable,
      },
    });
    revalidatePath('/admin/scorecard/queue');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
