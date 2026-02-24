import { NextResponse } from 'next/server';
import { getScorecardSnapshot } from '@/lib/agent-native/scorecard';

// GET /api/agent/scorecard - parity and CRUD scorecard report
export async function GET() {
  return NextResponse.json(getScorecardSnapshot());
}
