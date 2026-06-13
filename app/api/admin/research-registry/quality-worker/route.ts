import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { requireCronKey } from '@/lib/api/cron-auth';
import { getComplianceFeatureFlag } from '@/lib/research-registry/feature-flags';
import { processQualityRecomputeBatch } from '@/lib/research-registry/quality-queue';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/admin/research-registry/quality-worker — drain quality recompute queue (cron).
 * Optional API key: REGISTRY_QUALITY_WORKER_API_KEY
 */
async function handleWorker(request: NextRequest) {
  requireCronKey(request, 'REGISTRY_QUALITY_WORKER_API_KEY');

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
