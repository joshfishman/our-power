import * as Sentry from '@sentry/nextjs';

const hasSentryDsn = Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!hasSentryDsn) return;
  Sentry.captureException(error, {
    extra: context,
  });
}
