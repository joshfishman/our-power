import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { sendEmail } from '@/lib/email';

// POST /api/actions/[id]/send-email - Send an advocacy email on behalf of a user
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const action = await prisma.action.findUnique({
      where: { id: params.id },
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

    // Send emails to all targets
    const results = await Promise.allSettled(
      action.emailTargets.map((targetEmail) =>
        sendEmail({
          to: targetEmail,
          subject: action.emailSubject!,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="white-space: pre-wrap; line-height: 1.6;">${action.emailBody}</div>
              <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
              <p style="font-size: 12px; color: #6b7280;">
                Sent via Our Power on behalf of ${user?.name || 'a concerned citizen'}
                as part of the "${action.campaign.name}" campaign.
              </p>
            </div>
          `,
        }),
      ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

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

    return NextResponse.json({
      success: true,
      sent,
      failed,
      message: `Email sent to ${sent} recipient${sent !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`,
    });
  } catch (error) {
    console.error('Send email action error:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
