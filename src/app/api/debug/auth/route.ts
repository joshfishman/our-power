import { NextResponse } from 'next/server';

// Debug endpoint to check OAuth configuration - ONLY available in development
export async function GET() {
  // Block access in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const config = {
    google: {
      clientId: process.env.AUTH_GOOGLE_ID ? `${process.env.AUTH_GOOGLE_ID.slice(0, 20)}...` : 'NOT SET',
      clientSecret: process.env.AUTH_GOOGLE_SECRET ? 'SET (hidden)' : 'NOT SET',
    },
    facebook: {
      clientId: process.env.AUTH_FACEBOOK_ID ? `${process.env.AUTH_FACEBOOK_ID}` : 'NOT SET',
      clientSecret: process.env.AUTH_FACEBOOK_SECRET ? 'SET (hidden)' : 'NOT SET',
    },
    instagram: {
      clientId: process.env.AUTH_INSTAGRAM_ID ? `${process.env.AUTH_INSTAGRAM_ID}` : 'NOT SET',
      clientSecret: process.env.AUTH_INSTAGRAM_SECRET ? 'SET (hidden)' : 'NOT SET',
    },
    github: {
      clientId: process.env.AUTH_GITHUB_ID ? `${process.env.AUTH_GITHUB_ID}` : 'NOT SET',
      clientSecret: process.env.AUTH_GITHUB_SECRET ? 'SET (hidden)' : 'NOT SET',
    },
    nextauth: {
      secret: process.env.AUTH_SECRET ? 'SET (hidden)' : 'NOT SET',
      url: process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'NOT SET',
    },
    resend: {
      apiKey: process.env.RESEND_API_KEY ? 'SET (hidden)' : 'NOT SET',
    },
    environment: process.env.NODE_ENV,
    expectedCallbacks: {
      google: `${
        process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'https://op-pink.vercel.app'
      }/api/auth/callback/google`,
      facebook: `${
        process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'https://op-pink.vercel.app'
      }/api/auth/callback/facebook`,
      instagram: `${
        process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'https://op-pink.vercel.app'
      }/api/auth/callback/instagram`,
      github: `${
        process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'https://op-pink.vercel.app'
      }/api/auth/callback/github`,
    },
  };

  return NextResponse.json(config, { status: 200 });
}
