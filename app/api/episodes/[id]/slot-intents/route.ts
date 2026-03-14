import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/slot-intents
 * Returns open slot_intents for the episode (for cascade dialog when rescheduling).
 */
export const GET = authedHandler(async (req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT id, step_code as "stepCode", step_seq as "stepSeq",
            suggested_start as "suggestedStart", suggested_end as "suggestedEnd",
            window_start as "windowStart", window_end as "windowEnd",
            duration_minutes as "durationMinutes", pool
     FROM slot_intents
     WHERE episode_id = $1 AND state = 'open'
     ORDER BY step_seq ASC`,
    [episodeId]
  );

  return NextResponse.json({ intents: result.rows });
});
