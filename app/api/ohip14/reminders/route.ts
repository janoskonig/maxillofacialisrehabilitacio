import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { sendOhipReminders } from '@/lib/ohip14-reminders';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  return handle(req);
});

export const POST = apiHandler(async (req) => {
  return handle(req);
});

async function handle(request: NextRequest) {
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
}
