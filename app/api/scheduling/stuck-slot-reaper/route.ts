import { NextResponse } from 'next/server';
import { runStuckSlotReaper } from '@/lib/stuck-slot-reaper';
import { apiHandler } from '@/lib/api/route-handler';
import { requireCronKey } from '@/lib/api/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  return handleStuckSlotReaper(req);
});

export const POST = apiHandler(async (req) => {
  return handleStuckSlotReaper(req);
});

async function handleStuckSlotReaper(request: {
  headers: { get(name: string): string | null };
  nextUrl: { searchParams: URLSearchParams };
}) {
  // Same key as the other scripts/cron-sync.js-driven endpoints (sibling expiry
  // workers): a single cron service authenticates with GOOGLE_CALENDAR_SYNC_API_KEY.
  requireCronKey(request, 'GOOGLE_CALENDAR_SYNC_API_KEY');

  const result = await runStuckSlotReaper();

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    ...result,
  });
}
