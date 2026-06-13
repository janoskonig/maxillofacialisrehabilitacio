import { NextResponse } from 'next/server';
import { runIntentExpiry } from '@/lib/intent-expiry';
import { apiHandler } from '@/lib/api/route-handler';
import { requireCronKey } from '@/lib/api/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  return handleIntentExpiry(req);
});

export const POST = apiHandler(async (req, { correlationId }) => {
  return handleIntentExpiry(req);
});

async function handleIntentExpiry(request: { headers: { get(name: string): string | null }; nextUrl: { searchParams: URLSearchParams } }) {
  requireCronKey(request, 'SCHEDULING_INTENT_EXPIRY_API_KEY');

  const result = await runIntentExpiry();

  return NextResponse.json({
    success: result.errors.length === 0,
    timestamp: new Date().toISOString(),
    ...result,
  });
}
