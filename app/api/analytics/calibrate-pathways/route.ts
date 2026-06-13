import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { calibratePathwayAnalytics } from '@/lib/calibrate-pathway-analytics';
import { apiHandler } from '@/lib/api/route-handler';
import { hasValidCronKey } from '@/lib/api/cron-auth';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/analytics/calibrate-pathways
 * Run pathway analytics calibration. Protected by API key or admin-only.
 */
export const GET = apiHandler(async (req) => {
  return handleCalibrate(req);
});

export const POST = apiHandler(async (req) => {
  return handleCalibrate(req);
});

async function handleCalibrate(request: NextRequest) {
  if (!hasValidCronKey(request, 'GOOGLE_CALENDAR_SYNC_API_KEY')) {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const result = await calibratePathwayAnalytics();

  return NextResponse.json({
    success: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
}
