/**
 * Shared utilities for public API endpoints.
 * Provides CORS headers and rate limiting.
 */

import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowAllOrigins = process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0;

function resolveCorsOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (allowAllOrigins) return origin;
  if (allowedOrigins.includes('*')) return origin;
  if (allowedOrigins.includes(origin)) return origin;
  return null;
}

/** CORS headers for public read-only API endpoints */
export function corsHeaders(request: Request): HeadersInit {
  const origin = resolveCorsOrigin(request);
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

/** Standard OPTIONS response for CORS preflight */
export function corsOptionsResponse(request: Request): Response {
  const origin = resolveCorsOrigin(request);
  if (request.headers.get('origin') && !origin) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

/** Apply CORS headers to an existing Response */
export function withCors(response: Response, request: Request): Response {
  const origin = resolveCorsOrigin(request);
  if (request.headers.get('origin') && !origin) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function enforceRateLimit(
  request: Request,
  options?: { limit?: number; windowSeconds?: number },
): Promise<Response | null> {
  const ip = getClientIp(request);
  const rateLimitResponse = await checkRateLimit(ip, options);
  if (rateLimitResponse) {
    return new Response(rateLimitResponse.body, {
      status: rateLimitResponse.status,
      headers: rateLimitResponse.headers,
    });
  }
  return null;
}
