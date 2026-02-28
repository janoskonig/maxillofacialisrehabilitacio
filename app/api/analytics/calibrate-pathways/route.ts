import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { calibratePathwayAnalytics } from '@/lib/calibrate-pathway-analytics';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/analytics/calibrate-pathways
 * Run pathway analytics calibration. Protected by API key or admin-only.
 */
export async function GET(request: NextRequest) {
  return handleCalibrate(request);
}

export async function POST(request: NextRequest) {
  return handleCalibrate(request);
}

async function handleCalibrate(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const expectedApiKey = process.env.GOOGLE_CALENDAR_SYNC_API_KEY;

    if (expectedApiKey && apiKey !== expectedApiKey) {
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[calibrate-pathways] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
