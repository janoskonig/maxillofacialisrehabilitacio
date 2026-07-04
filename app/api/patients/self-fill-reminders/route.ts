import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { sendPatientSelfFillReminders } from '@/lib/patient-selffill-reminders';
import { apiHandler } from '@/lib/api/route-handler';
import { hasValidCronKey } from '@/lib/api/cron-auth';

export const dynamic = 'force-dynamic';

/**
 * Beteg-önkitöltési nudge futtatása (cron / admin) — az OHIP-emlékeztetők
 * mintájára: portál-feladat + push + heti e-mail a beteg által önkitölthető
 * hiányzó mezőkről.
 */
export const GET = apiHandler(async (req) => {
  return handle(req);
});

export const POST = apiHandler(async (req) => {
  return handle(req);
});

async function handle(request: NextRequest) {
  if (!hasValidCronKey(request, 'GOOGLE_CALENDAR_SYNC_API_KEY')) {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const result = await sendPatientSelfFillReminders();

  return NextResponse.json({
    success: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
}
