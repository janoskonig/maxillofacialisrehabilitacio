import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runRebalance } from '@/lib/rebalance-capacity-pools';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * POST/GET /api/capacity/rebalance — nightly capacity pool rebalance (cron)
 * Protects with API key when CAPACITY_REBALANCE_API_KEY is set.
 */
export async function GET(request: NextRequest) {
  return handleRebalance(request);
}

export async function POST(request: NextRequest) {
  return handleRebalance(request);
}

async function handleRebalance(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const expectedKey = process.env.CAPACITY_REBALANCE_API_KEY;

    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runRebalance();

    return NextResponse.json({
      success: result.errors.length === 0,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    logger.error('Rebalance error:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kapacitás újraegyensúlyozásakor', details: String(error) },
      { status: 500 }
    );
  }
}
