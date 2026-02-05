import 'server-only';
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
      console.error('Resend email error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    console.log('Email sent successfully:', data?.id);
    return data;
  } catch (err) {
    console.error('Email send exception:', err);
    throw err;
  }
}
