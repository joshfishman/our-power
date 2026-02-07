import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Rate limiter for API routes.
 * Uses Upstash if configured, falls back to in-memory for local/dev.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useUpstash = Boolean(upstashUrl && upstashToken);

const limiterCache = new Map<string, Ratelimit>();

function getUpstashLimiter(options: Required<RateLimitOptions>): Ratelimit | null {
  if (!useUpstash) return null;
  const key = `${options.limit}:${options.windowSeconds}`;
  const cached = limiterCache.get(key);
  if (cached) return cached;

  const redis = new Redis({
    url: upstashUrl!,
    token: upstashToken!,
  });

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(options.limit, `${options.windowSeconds} s`),
    analytics: true,
  });

  limiterCache.set(key, limiter);
  return limiter;
}

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
export async function checkRateLimit(identifier: string, options: RateLimitOptions = {}): Promise<NextResponse | null> {
  const { limit = 60, windowSeconds = 60 } = options;
  const normalizedOptions = { limit, windowSeconds };

  const upstashLimiter = getUpstashLimiter(normalizedOptions);
  if (upstashLimiter) {
    const { success, reset } = await upstashLimiter.limit(identifier);
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
          },
        },
      );
    }
    return null;
  }

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
const ipv4Regex = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const ipv6Regex = /^[0-9a-fA-F:]+$/;

function isValidIp(value: string): boolean {
  if (ipv4Regex.test(value)) return true;
  if (ipv6Regex.test(value)) return true;
  return false;
}

export function getClientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp && isValidIp(realIp)) return realIp;

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first && isValidIp(first)) return first;
  }

  return 'unknown';
}
