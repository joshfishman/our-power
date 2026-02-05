import { NextResponse } from 'next/server';

/**
 * Simple in-memory rate limiter for API routes.
 * For production at scale, replace with @upstash/ratelimit or similar.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000);

interface RateLimitOptions {
  /** Max requests per window */
  limit?: number;
  /** Window duration in seconds */
  windowSeconds?: number;
}

/**
 * Check rate limit for a given identifier (usually IP).
 * Returns null if allowed, or a NextResponse with 429 if rate limited.
 */
export function checkRateLimit(identifier: string, options: RateLimitOptions = {}): NextResponse | null {
  const { limit = 60, windowSeconds = 60 } = options;
  const now = Date.now();
  const key = identifier;

  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return null;
  }

  entry.count += 1;

  if (entry.count > limit) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)),
        },
      },
    );
  }

  return null;
}

/**
 * Get client IP from request headers (works behind Vercel/Cloudflare proxies).
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || 'unknown';
}
