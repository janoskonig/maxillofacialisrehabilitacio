import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { buildBookingConsistencyReport } from '@/lib/booking-consistency-report';

export const dynamic = 'force-dynamic';

/**
 * Admin-only read-only consistency probe for the work-phase ↔ appointment ↔ slot-intent
 * graph. Used by the work-phase-booking-stabilization plan (Phase 2) to size
 * the cleanup before introducing the canonical `appointments.work_phase_id`
 * relationship.
 *
 * Query params:
 *   - sampleLimit: 1..200 (default 25)
 */
export const GET = roleHandler(['admin'], async (req) => {
  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('sampleLimit');
  const sampleLimit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;

  const report = await buildBookingConsistencyReport(getDbPool(), {
    sampleLimit: Number.isFinite(sampleLimit ?? NaN) ? sampleLimit : undefined,
  });

  return NextResponse.json(report);
});
