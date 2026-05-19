import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { getComplianceFeatureFlag } from '@/lib/tmk/feature-flags';
import { processQualityRecomputeBatch } from '@/lib/tmk/quality-queue';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/admin/tmk/quality-worker — drain quality recompute queue (cron).
 * Optional API key: TMK_QUALITY_WORKER_API_KEY
 */
async function handleWorker(request: NextRequest) {
  const apiKey =
    request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
  const expectedKey = process.env.TMK_QUALITY_WORKER_API_KEY;

  if (expectedKey && apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enabled = await getComplianceFeatureFlag('quality_recompute_queue');
  if (!enabled) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'quality_recompute_queue flag is disabled',
      processed: 0,
      timestamp: new Date().toISOString(),
    });
  }

  const processed = await processQualityRecomputeBatch();

  return NextResponse.json({
    success: true,
    processed,
    timestamp: new Date().toISOString(),
  });
}

export const GET = apiHandler(async (req) => handleWorker(req));
export const POST = apiHandler(async (req) => handleWorker(req));
