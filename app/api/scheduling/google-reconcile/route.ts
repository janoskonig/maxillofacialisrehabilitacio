import { NextResponse } from 'next/server';
import { runGoogleReconciliation } from '@/lib/google-reconciliation';
import { apiHandler } from '@/lib/api/route-handler';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req, { correlationId }) => {
  const startTime = Date.now();

  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.GOOGLE_CALENDAR_SYNC_API_KEY;

  if (expectedApiKey && apiKey !== expectedApiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await runGoogleReconciliation();

  const totalConflicts = results.reduce((s, r) => s + r.conflicts.length, 0);
  const totalBlocks = results.reduce((s, r) => s + r.blocksApplied, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  const duration = Date.now() - startTime;

  return NextResponse.json({
    success: totalErrors === 0,
    timestamp: new Date().toISOString(),
    durationMs: duration,
    usersProcessed: results.length,
    summary: {
      slotsChecked: results.reduce((s, r) => s + r.slotsChecked, 0),
      conflictsFound: totalConflicts,
      slotsBlocked: totalBlocks,
      errors: totalErrors,
    },
    details: results,
  });
});
