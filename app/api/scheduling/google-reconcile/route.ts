import { NextRequest, NextResponse } from 'next/server';
import { runGoogleReconciliation } from '@/lib/google-reconciliation';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/scheduling/google-reconcile
 * Nightly reconciliation job: compare DB booked appointments with Google target calendar.
 * Conflicts auto-mark affected DB slots as `blocked`; require manual resolution.
 * Protected by API key (same as sync cron).
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Google Reconcile] Error:', msg);
    return NextResponse.json(
      { error: 'Reconciliation failed', details: msg },
      { status: 500 }
    );
  }
}
