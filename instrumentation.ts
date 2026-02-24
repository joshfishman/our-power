import * as Sentry from '@sentry/nextjs';

const baseSentryOptions = {
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
};

export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init(baseSentryOptions);
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(baseSentryOptions);
  }
}

export const onRequestError = Sentry.captureRequestError;
