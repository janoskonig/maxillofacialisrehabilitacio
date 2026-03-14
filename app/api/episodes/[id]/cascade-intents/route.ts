import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/cascade-intents
 * Shift selected slot_intents by a delta (e.g. when rescheduling an appointment).
 * Body: { delta: { days: number; hours?: number; minutes?: number }; intentIds: string[] }
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { params }) => {
  const episodeId = params.id;
  const body = await req.json().catch(() => ({}));
  const { delta, intentIds } = body;

  if (!delta || typeof delta.days !== 'number') {
    return NextResponse.json(
      { error: 'delta.days (number) kötelező' },
      { status: 400 }
    );
  }
  if (!Array.isArray(intentIds) || intentIds.length === 0) {
    return NextResponse.json(
      { error: 'intentIds (nem üres tömb) kötelező' },
      { status: 400 }
    );
  }

  const deltaMs =
    delta.days * 24 * 60 * 60 * 1000 +
    (typeof delta.hours === 'number' ? delta.hours : 0) * 60 * 60 * 1000 +
    (typeof delta.minutes === 'number' ? delta.minutes : 0) * 60 * 1000;

  const pool = getDbPool();

  const intentsResult = await pool.query(
    `SELECT id, suggested_start, suggested_end, window_start, window_end
     FROM slot_intents
     WHERE episode_id = $1 AND id = ANY($2) AND state = 'open'`,
    [episodeId, intentIds]
  );

  if (intentsResult.rows.length !== intentIds.length) {
    return NextResponse.json(
      { error: 'Nem minden intent található vagy nem open állapotú ehhez az epizódhoz' },
      { status: 400 }
    );
  }

  for (const row of intentsResult.rows) {
    const newSuggestedStart = row.suggested_start
      ? new Date(new Date(row.suggested_start).getTime() + deltaMs)
      : null;
    const newSuggestedEnd = row.suggested_end
      ? new Date(new Date(row.suggested_end).getTime() + deltaMs)
      : null;
    const newWindowStart = row.window_start
      ? new Date(new Date(row.window_start).getTime() + deltaMs)
      : null;
    const newWindowEnd = row.window_end
      ? new Date(new Date(row.window_end).getTime() + deltaMs)
      : null;

    await pool.query(
      `UPDATE slot_intents
       SET suggested_start = $1, suggested_end = $2, window_start = $3, window_end = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [newSuggestedStart, newSuggestedEnd, newWindowStart, newWindowEnd, row.id]
    );
  }

  return NextResponse.json({ updated: intentsResult.rows.length });
});
