import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { sendEmail } from '@/lib/email';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { logActionCompleted, logActionRSVP } from '@/lib/notifications/campaignNotifications';
import { z } from 'zod';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// POST /api/actions/[id]/send-email - Send an advocacy email on behalf of a user
export async function POST(request: Request, { params }: { params: { id: string } }) {
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

    if (!action.emailTargets || action.emailTargets.length === 0) {
      return NextResponse.json({ error: 'No email targets configured' }, { status: 400 });
    }

    // Get user info for attribution
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true },
    });

    const safeSubject = action.emailSubject.replace(/[\r\n]+/g, ' ').trim();
    const safeBody = escapeHtml(action.emailBody);
    const safeUserName = escapeHtml(user?.name || 'a concerned citizen');
    const safeCampaignName = escapeHtml(action.campaign.name);

    // Send emails to all targets
    const results = await Promise.allSettled(
      action.emailTargets.map((targetEmail) =>
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
