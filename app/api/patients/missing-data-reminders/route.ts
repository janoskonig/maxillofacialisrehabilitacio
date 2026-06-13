import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { apiHandler } from '@/lib/api/route-handler';
import { hasValidCronKey } from '@/lib/api/cron-auth';
import { sendMissingDataReminders } from '@/lib/missing-data-reminders';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/patients/missing-data-reminders
 *
 * Külső ütemező (hetente) hívja `x-api-key`-jel (GOOGLE_CALENDAR_SYNC_API_KEY),
 * vagy admin felhasználó indíthatja manuálisan. Minden hiányzó adattal rendelkező
 * betegnél értesíti a beutaló orvost és a legutóbbi fogpótlástanászt (e-mailben +
 * feladatként); ha egy hét után is hiányzik az adat, ismételt e-mailt küld.
 */
export const GET = apiHandler(async (req) => handle(req));
export const POST = apiHandler(async (req) => handle(req));

async function handle(request: NextRequest) {
  if (!hasValidCronKey(request, 'GOOGLE_CALENDAR_SYNC_API_KEY')) {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const result = await sendMissingDataReminders();

  return NextResponse.json({
    success: result.errors === 0,
    ...result,
    timestamp: new Date().toISOString(),
  });
}
