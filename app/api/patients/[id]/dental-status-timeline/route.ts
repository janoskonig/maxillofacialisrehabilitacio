import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDentalStatusTimeline } from '@/lib/dental-status-snapshots';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients/:id/dental-status-timeline
 * A fogazati státusz idővonala: kiindulási állapot, datált státuszok, a nyitott
 * kezelésekből származtatott kezelési terv és a jelenlegi állapot.
 */
export const GET = authedHandler(async (_req, { auth, params }) => {
  if (!['admin', 'beutalo_orvos', 'fogpótlástanász', 'technikus'].includes(auth.role)) {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
  }
  const timeline = await getDentalStatusTimeline(params.id);
  return NextResponse.json(timeline);
});
