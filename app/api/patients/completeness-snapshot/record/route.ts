import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { hasValidCronKey } from '@/lib/api/cron-auth';
import { verifyAuth } from '@/lib/auth-server';
import { recordCompletenessSnapshot } from '@/lib/completeness-snapshot';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/patients/completeness-snapshot/record
 *
 * Rögzíti a mai adat-teljességi pillanatképet (egy sor / nap, idempotens).
 * Külső ütemező (naponta) hívja `x-api-key`-jel, vagy admin indíthatja
 * (`?force=1`-gyel felülírja a mai sort).
 */
export const GET = apiHandler(async (req) => handle(req));
export const POST = apiHandler(async (req) => handle(req));

async function handle(request: NextRequest) {
  const isCron = hasValidCronKey(request, 'GOOGLE_CALENDAR_SYNC_API_KEY');
  let isAdmin = false;
  if (!isCron) {
    const auth = await verifyAuth(request);
    isAdmin = auth?.role === 'admin';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Admin kézzel felülírhatja a mai sort `?force=1`-gyel.
  const force = isAdmin && request.nextUrl.searchParams.get('force') === '1';
  const result = await recordCompletenessSnapshot({ force });

  return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() });
}
