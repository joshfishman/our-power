/**
 * Shared utilities for public API endpoints.
 * Provides CORS headers and rate limiting.
 */

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

/** CORS headers for public read-only API endpoints */
export function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

/** Standard OPTIONS response for CORS preflight */
export function corsOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

/** Apply CORS headers to an existing Response */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders();
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Simple in-memory rate limiter using a sliding window.
 * Suitable for serverless/edge deployments where state is per-instance.
 * For production at scale, consider Vercel KV or Upstash Redis.
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute per IP

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  return false;
}

export function rateLimitedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '60',
      ...corsHeaders(),
    },
  });
}
