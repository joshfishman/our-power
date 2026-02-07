import 'server-only';
import { logError, logInfo } from '@/lib/logger';
import { resend } from './resend';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, from }: SendEmailOptions) {
  const fromAddress = from || 'Our Power <noreply@resend.dev>';

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to,
      subject,
      html,
    });

    if (error) {
      logError('Resend email error', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    logInfo('Email sent successfully', { id: data?.id });
    return data;
  } catch (err) {
    logError('Email send exception', err);
    throw err;
  }
}
