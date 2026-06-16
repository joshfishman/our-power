'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/lib/prisma/prisma';
import { isScorecardAdmin } from '@/lib/scorecard/admin-auth';

// Per-bill roll-call classification review.
//
// The existing /admin/scorecard/queue reviews ONE RollCallVote row at a time.
// This surface works at the bill level: a single bill (chamber + billType +
// billNumber) can carry multiple roll-call rows (e.g. a procedural vote and a
// passage vote, or votes across sessions). 146 of our 561 scorable bills have
// more than one scorable roll-call row, so an admin decision about how a bill
// maps to a plank must apply to EVERY matching RollCallVote row at once.
//
// Each action below resolves the target rows by (chamber, billType, billNumber)
// and writes only those rows. All actions are guarded by isScorecardAdmin and
// validate input with Zod, mirroring queue/actions.ts.

const ALLOWED_CHAMBERS = ['HOUSE', 'SENATE', 'CA_ASSEMBLY', 'CA_SENATE'] as const;

// A bill key uniquely identifies the group of RollCallVote rows we mutate.
const billKeySchema = z.object({
  chamber: z.enum(ALLOWED_CHAMBERS),
  billType: z.string().min(1).max(16),
  billNumber: z.string().min(1).max(16),
});

const planksSchema = z
  .array(z.number().int().min(1).max(5))
  .transform((arr) => [...new Set(arr)].sort((a, b) => a - b));

const alignedSchema = z.enum(['YES', 'NO', 'NONE']);

type ActionResult = { ok: boolean; error?: string; updated?: number };

function parsePlanks(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n));
}

async function resolveBillKey(formData: FormData) {
  return billKeySchema.safeParse({
    chamber: String(formData.get('chamber') ?? ''),
    billType: String(formData.get('billType') ?? ''),
    billNumber: String(formData.get('billNumber') ?? ''),
  });
}

// (a) CONFIRM — accept the existing auto-classification as-is. Stamps the
// human-review fields without changing plankNumbers / alignedPosition.
export async function confirmBill(formData: FormData): Promise<ActionResult> {
  const { allowed, email } = await isScorecardAdmin();
  if (!allowed) return { ok: false, error: 'Not authorized' };

  const key = await resolveBillKey(formData);
  if (!key.success) return { ok: false, error: 'Invalid bill key' };

  try {
    const res = await prisma.rollCallVote.updateMany({
      where: key.data,
      data: {
        classificationSource: 'auto-then-human',
        reviewedAt: new Date(),
        reviewedBy: email ?? 'unknown-admin',
      },
    });
    revalidatePath('/admin/scorecard/classify');
    return { ok: true, updated: res.count };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// (b) OVERRIDE — replace plankNumbers and/or alignedPosition. Marks the
// classification fully human-authored. Bumps confidence to 1.0 (admin is the
// authority) and recomputes isScorable from the override values.
export async function overrideBill(formData: FormData): Promise<ActionResult> {
  const { allowed, email } = await isScorecardAdmin();
  if (!allowed) return { ok: false, error: 'Not authorized' };

  const key = await resolveBillKey(formData);
  if (!key.success) return { ok: false, error: 'Invalid bill key' };

  const planksResult = planksSchema.safeParse(parsePlanks(String(formData.get('plankNumbers') ?? '')));
  if (!planksResult.success) return { ok: false, error: 'Invalid plank numbers' };

  const alignedResult = alignedSchema.safeParse(String(formData.get('alignedPosition') ?? 'NONE'));
  if (!alignedResult.success) return { ok: false, error: 'Invalid aligned position' };

  const plankNumbers = planksResult.data;
  const alignedPosition = alignedResult.data === 'NONE' ? null : alignedResult.data;
  // A bill only scores when it maps to at least one plank AND we know which
  // direction is platform-aligned. Otherwise it stays in the universe but
  // contributes nothing — same rule as queue/actions.ts.
  const isScorable = plankNumbers.length > 0 && alignedPosition !== null;

  try {
    const res = await prisma.rollCallVote.updateMany({
      where: key.data,
      data: {
        plankNumbers,
        alignedPosition,
        classificationConfidence: 1.0,
        classificationSource: 'human',
        classificationReasoning: `Admin override by ${
          email ?? 'unknown-admin'
        } on ${new Date().toISOString()}: planks=[${plankNumbers.join(',')}] aligned=${alignedPosition ?? 'none'}`,
        reviewedAt: new Date(),
        reviewedBy: email ?? 'unknown-admin',
        isScorable,
      },
    });
    revalidatePath('/admin/scorecard/classify');
    return { ok: true, updated: res.count };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// (c) EXCLUDE — drop the bill from scoring entirely (e.g. it's procedural or
// off-topic). Sets isScorable=false and stamps review fields, but leaves the
// existing classification metadata so the decision is reversible via override.
export async function excludeBill(formData: FormData): Promise<ActionResult> {
  const { allowed, email } = await isScorecardAdmin();
  if (!allowed) return { ok: false, error: 'Not authorized' };

  const key = await resolveBillKey(formData);
  if (!key.success) return { ok: false, error: 'Invalid bill key' };

  try {
    const res = await prisma.rollCallVote.updateMany({
      where: key.data,
      data: {
        isScorable: false,
        classificationSource: 'human',
        reviewedAt: new Date(),
        reviewedBy: email ?? 'unknown-admin',
      },
    });
    revalidatePath('/admin/scorecard/classify');
    return { ok: true, updated: res.count };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
