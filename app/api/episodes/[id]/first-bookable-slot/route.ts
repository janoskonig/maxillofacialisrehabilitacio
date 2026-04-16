import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import {
  getFirstBookableSlotForEpisode,
  canUseProviderScopeAll,
  type FirstBookableProviderScope,
} from '@/lib/first-bookable-slot';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/first-bookable-slot
 * Earliest free slot for nextRequiredStep in that step's window (optional providerScope=all for staff).
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const scopeRaw = req.nextUrl.searchParams.get('providerScope');
  const providerScope: FirstBookableProviderScope =
    scopeRaw === 'all' ? 'all' : 'episode';

  if (providerScope === 'all' && !canUseProviderScopeAll(auth.role)) {
    return NextResponse.json(
      { error: 'providerScope=all csak admin, beutaló orvos vagy fogpótlástanász számára engedélyezett.' },
      { status: 403 }
    );
  }

  const pool = getDbPool();
  const episodeResult = await pool.query(`SELECT id FROM patient_episodes pe WHERE pe.id = $1`, [episodeId]);
  if (episodeResult.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  const payload = await getFirstBookableSlotForEpisode(episodeId, {
    providerScope,
    authRole: auth.role,
  });

  if (payload.kind === 'blocked') {
    return NextResponse.json(payload, {
      status: payload.code === 'NO_CARE_PATHWAY' ? 409 : 200,
    });
  }

  return NextResponse.json(payload);
});
