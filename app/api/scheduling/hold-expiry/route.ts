import { NextRequest, NextResponse } from 'next/server';
import { runHoldExpiry } from '@/lib/hold-expiry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST/GET /api/scheduling/hold-expiry — hold expiry worker (cron every 5–10 min)
 * Protects with API key when SCHEDULING_HOLD_EXPIRY_API_KEY is set.
 */
export async function GET(request: NextRequest) {
  return handleHoldExpiry(request);
}

export async function POST(request: NextRequest) {
  return handleHoldExpiry(request);
}

async function handleHoldExpiry(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const expectedKey = process.env.SCHEDULING_HOLD_EXPIRY_API_KEY;

    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runHoldExpiry();

    return NextResponse.json({
      success: result.errors.length === 0,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error('Hold expiry error:', error);
    return NextResponse.json(
      { error: 'Hiba történt a hold lejárat kezelésekor', details: String(error) },
      { status: 500 }
    );
  }
}
