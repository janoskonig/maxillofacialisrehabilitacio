import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getCompletenessSnapshots } from '@/lib/completeness-snapshot';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients/completeness-snapshot?days=90
 * Az adat-teljességi pontszám időbeli alakulása a vezetői nézet trend-grafikonjához.
 * Csak admin.
 */
export const GET = authedHandler(async (req, { auth }) => {
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
  }
  const daysParam = Number(req.nextUrl.searchParams.get('days'));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 90;
  const snapshots = await getCompletenessSnapshots(days);
  return NextResponse.json({ success: true, snapshots });
});
