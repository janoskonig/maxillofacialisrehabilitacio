import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { requireCronKey } from '@/lib/api/cron-auth';
import { runRebalance } from '@/lib/rebalance-capacity-pools';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * POST/GET /api/capacity/rebalance — nightly capacity pool rebalance (cron)
 * Protects with API key when CAPACITY_REBALANCE_API_KEY is set.
 */
export const GET = apiHandler(async (req) => {
  return handleRebalance(req);
});

export const POST = apiHandler(async (req) => {
  return handleRebalance(req);
});

async function handleRebalance(request: NextRequest) {
  requireCronKey(request, 'CAPACITY_REBALANCE_API_KEY');

  const result = await runRebalance();

  return NextResponse.json({
    success: result.errors.length === 0,
    timestamp: new Date().toISOString(),
    ...result,
  });
}
