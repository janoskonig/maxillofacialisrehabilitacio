import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { sendAdminDailySummary } from '@/lib/email/admin-notification-queue';
import { apiHandler } from '@/lib/api/route-handler';
import { hasValidCronKey } from '@/lib/api/cron-auth';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  return handle(req);
});

export const POST = apiHandler(async (req) => {
  return handle(req);
});

async function handle(request: NextRequest) {
  const auth = await verifyAuth(request);

  if (!hasValidCronKey(request, 'GOOGLE_CALENDAR_SYNC_API_KEY')) {
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const bypassMinInterval = auth?.role === 'admin' && request.nextUrl.searchParams.get('force') === '1';

  const result = await sendAdminDailySummary({ bypassMinInterval });

  return NextResponse.json({
    success: true,
    sent: result.sent,
    notificationCount: result.count,
    reason: result.reason,
  });
}
