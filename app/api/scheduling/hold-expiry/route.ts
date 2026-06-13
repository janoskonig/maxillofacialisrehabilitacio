import { NextResponse } from 'next/server';
import { runHoldExpiry } from '@/lib/hold-expiry';
import { apiHandler } from '@/lib/api/route-handler';
import { requireCronKey } from '@/lib/api/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  return handleHoldExpiry(req);
});

export const POST = apiHandler(async (req, { correlationId }) => {
  return handleHoldExpiry(req);
});

async function handleHoldExpiry(request: { headers: { get(name: string): string | null }; nextUrl: { searchParams: URLSearchParams } }) {
  requireCronKey(request, 'SCHEDULING_HOLD_EXPIRY_API_KEY');

  const result = await runHoldExpiry();

  return NextResponse.json({
    success: result.errors.length === 0,
    timestamp: new Date().toISOString(),
    ...result,
  });
}
