import { NextResponse } from 'next/server';
import { runIntentExpiry } from '@/lib/intent-expiry';
import { apiHandler } from '@/lib/api/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  return handleIntentExpiry(req);
});

export const POST = apiHandler(async (req, { correlationId }) => {
  return handleIntentExpiry(req);
});

async function handleIntentExpiry(request: { headers: { get(name: string): string | null }; nextUrl: { searchParams: URLSearchParams } }) {
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
}
