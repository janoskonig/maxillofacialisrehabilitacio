import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { sendOhipReminders } from '@/lib/ohip14-reminders';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/ohip14/reminders
 * Send weekly OHIP-14 email reminders for patients with pending questionnaires.
 * Protected by API key (cron) or admin auth.
 */
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const expectedApiKey = process.env.GOOGLE_CALENDAR_SYNC_API_KEY;

    if (expectedApiKey && apiKey !== expectedApiKey) {
      const auth = await verifyAuth(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const result = await sendOhipReminders();

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[ohip14-reminders] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
