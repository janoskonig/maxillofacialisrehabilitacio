import { NextRequest, NextResponse } from 'next/server';
import { runIntentExpiry } from '@/lib/intent-expiry';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST/GET /api/scheduling/intent-expiry — intent TTL expiry worker (cron)
 * Protects with API key when SCHEDULING_INTENT_EXPIRY_API_KEY is set.
 */
export async function GET(request: NextRequest) {
  return handleIntentExpiry(request);
}

export async function POST(request: NextRequest) {
  return handleIntentExpiry(request);
}

async function handleIntentExpiry(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const expectedKey = process.env.SCHEDULING_INTENT_EXPIRY_API_KEY;

    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runIntentExpiry();

    return NextResponse.json({
      success: result.errors.length === 0,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    logger.error('Intent expiry error:', error);
    return NextResponse.json(
      { error: 'Hiba történt az intent lejárat kezelésekor', details: String(error) },
      { status: 500 }
    );
  }
}
