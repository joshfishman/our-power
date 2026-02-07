/* eslint-disable no-console */
import { captureException } from '@/lib/monitoring';

type LogContext = Record<string, unknown>;

const isProd = process.env.NODE_ENV === 'production';

function formatContext(context?: LogContext): string {
  if (!context) return '';
  try {
    return JSON.stringify(context);
  } catch {
    return '[unserializable-context]';
  }
}

export function logError(message: string, error?: unknown, context?: LogContext): void {
  captureException(error ?? message, context);
  if (isProd) {
    console.error(message);
    return;
  }
  console.error(message, error, formatContext(context));
}

export function logWarn(message: string, context?: LogContext): void {
  if (isProd) {
    console.warn(message);
    return;
  }
  console.warn(message, formatContext(context));
}

export function logInfo(message: string, context?: LogContext): void {
  if (isProd) {
    console.info(message);
    return;
  }
  console.info(message, formatContext(context));
}

export function logDebug(message: string, context?: LogContext): void {
  if (process.env.AUTH_DEBUG === 'true' || !isProd) {
    console.debug(message, formatContext(context));
  }
}
