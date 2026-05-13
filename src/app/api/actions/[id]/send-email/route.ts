import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { sendEmail } from '@/lib/email';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { logActionCompleted, logActionRSVP } from '@/lib/notifications/campaignNotifications';
import { resolveRepresentatives } from '@/lib/integrations/representatives';
import { z } from 'zod';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getLevel = (officeName: string) => {
  const normalized = officeName.toLowerCase();
  if (
    normalized.includes('united states') ||
    normalized.includes('u.s.') ||
    normalized.includes('us senate') ||
    normalized.includes('senate') ||
    normalized.includes('house of representatives') ||
    normalized.includes('congress') ||
    normalized.includes('president') ||
    normalized.includes('vice president')
  ) {
    return 'FEDERAL';
  }
  if (
    normalized.includes('state') ||
    normalized.includes('governor') ||
    normalized.includes('attorney general') ||
    normalized.includes('secretary of state') ||
    normalized.includes('treasurer') ||
    normalized.includes('comptroller')
  ) {
    return 'STATE';
  }
  return 'LOCAL';
};

// POST /api/actions/[id]/send-email - Send an advocacy email on behalf of a user
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 10, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actionId = z.string().min(1).safeParse(params.id);
    if (!actionId.success) {
      return NextResponse.json({ error: 'Invalid action id' }, { status: 400 });
    }

    const action = await prisma.action.findUnique({
      where: { id: actionId.data },
      include: {
        campaign: {
          select: { id: true, name: true },
        },
      },
    });

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    if (action.type !== 'EMAIL') {
      return NextResponse.json({ error: 'This action is not an email action' }, { status: 400 });
    }

    if (!action.emailSubject || !action.emailBody) {
      return NextResponse.json({ error: 'Email action is missing subject or body' }, { status: 400 });
    }

    // Get user info for attribution
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, zipCode: true, streetAddress: true },
    });

    let requestedTargets: string[] | null = null;
    let requestedSubject: string | null = null;
    let requestedBody: string | null = null;
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await request.json();
      const parsed = z
        .object({
          targets: z.array(z.string().email()).optional(),
          subject: z.string().min(1).optional(),
          body: z.string().min(1).optional(),
        })
        .safeParse(body);
      if (parsed.success) {
        requestedTargets = parsed.data.targets ?? null;
        requestedSubject = parsed.data.subject ?? null;
        requestedBody = parsed.data.body ?? null;
      }
    }

    const resolveCivicEmails = async (): Promise<string[]> => {
      const addressParts = [user?.streetAddress, user?.zipCode].filter(Boolean);
      if (!addressParts.length) {
        throw new Error('Add your address to find representatives');
      }

      const { officials } = await resolveRepresentatives(addressParts.join(', '));

      const targetOffices = (action.targetOffices || []).map((o) => o.toLowerCase().trim()).filter(Boolean);
      const filtered = officials.filter((rep) => {
        if (action.targetLevel && getLevel(rep.office) !== action.targetLevel) return false;
        if (!targetOffices.length) return true;
        const officeLower = rep.office.toLowerCase();
        const nameLower = rep.name.toLowerCase();
        return targetOffices.some((f) => officeLower.includes(f) || nameLower.includes(f));
      });

      const emails = filtered.flatMap((rep) => rep.emails);
      const uniqueEmails = Array.from(new Set(emails.map((e) => e.trim()).filter(Boolean)));
      if (requestedTargets?.length) {
        return uniqueEmails.filter((e) => requestedTargets?.includes(e));
      }
      return uniqueEmails;
    };

    let targetEmails: string[] = [];
    const manualEmails =
      (action.manualTargets as Array<{ email?: string | null }> | null | undefined)
        ?.map((target) => target.email?.trim())
        .filter((target): target is string => Boolean(target)) || [];

    if (action.targetMode === 'MANUAL') {
      targetEmails = manualEmails;
    } else if (action.targetMode === 'CIVIC' || action.targetMode === 'BOTH') {
      let civicEmails: string[] = [];
      try {
        civicEmails = await resolveCivicEmails();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to resolve representatives';
        return NextResponse.json({ error: message }, { status: 400 });
      }
      targetEmails =
        action.targetMode === 'BOTH' ? Array.from(new Set([...manualEmails, ...civicEmails])) : civicEmails;
    } else {
      targetEmails = action.emailTargets || [];
    }

    if (!targetEmails.length) {
      return NextResponse.json({ error: 'No email targets configured' }, { status: 400 });
    }

    const resolvedSubject = requestedSubject?.trim() || action.emailSubject;
    const resolvedBody = requestedBody?.trim() || action.emailBody;
    const safeSubject = resolvedSubject.replace(/[\r\n]+/g, ' ').trim();
    const safeBody = escapeHtml(resolvedBody);
    const safeUserName = escapeHtml(user?.name || 'a concerned citizen');
    const safeCampaignName = escapeHtml(action.campaign.name);

    // Send emails to all targets
    const results = await Promise.allSettled(
      targetEmails.map((targetEmail) =>
        sendEmail({
          to: targetEmail,
          subject: safeSubject,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="white-space: pre-wrap; line-height: 1.6;">${safeBody}</div>
              <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
              <p style="font-size: 12px; color: #6b7280;">
                Sent via Our Power on behalf of ${safeUserName}
                as part of the "${safeCampaignName}" campaign.
              </p>
            </div>
          `,
        }),
      ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    const existingParticipation = await prisma.actionParticipation.findUnique({
      where: {
        userId_actionId: {
          userId: session.user.id,
          actionId: action.id,
        },
      },
    });

    // Mark participation as completed
    await prisma.actionParticipation.upsert({
      where: {
        userId_actionId: {
          userId: session.user.id,
          actionId: action.id,
        },
      },
      update: {
        attended: true,
        completedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        actionId: action.id,
        willAttend: true,
        attended: true,
        completedAt: new Date(),
      },
    });

    if (!existingParticipation?.willAttend) {
      await logActionRSVP({ userId: session.user.id, actionId: action.id, campaignId: action.campaignId });
    }
    if (!existingParticipation?.attended) {
      await logActionCompleted({ userId: session.user.id, actionId: action.id, campaignId: action.campaignId });
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
      message: `Email sent to ${sent} recipient${sent !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`,
    });
  } catch (error) {
    logError('Send email action error', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
