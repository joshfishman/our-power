import { NextResponse } from 'next/server';
import { createActionReminders } from '@/lib/notifications';

// This endpoint should be called by a cron job (e.g., Vercel Cron)
// Add to vercel.json: { "crons": [{ "path": "/api/cron/reminders", "schedule": "0 9 * * *" }] }

export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access (fail closed)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await createActionReminders();
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json({ error: 'Failed to create reminders' }, { status: 500 });
  }
}
