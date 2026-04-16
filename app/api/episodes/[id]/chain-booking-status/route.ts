import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { chainBookingRequiredFromCounts } from '@/lib/chain-booking-status';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/chain-booking-status
 * Whether this episode should show the mandatory full-chain booking wizard.
 */
export const GET = authedHandler(async (req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const exists = await pool.query(`SELECT 1 FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (exists.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  let mergedFilter = '';
  try {
    const epCols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'episode_work_phases' AND column_name = 'merged_into_episode_work_phase_id'`
    );
    if (epCols.rows.length > 0) {
      mergedFilter = 'AND merged_into_episode_work_phase_id IS NULL';
    }
  } catch {
    /* ignore */
  }

  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM slot_intents
        WHERE episode_id = $1 AND state = 'open' AND pool = 'work') AS open_work_intents,
       (SELECT COUNT(*)::int FROM episode_work_phases
        WHERE episode_id = $1 AND status IN ('pending', 'scheduled') ${mergedFilter}) AS pending_phases`,
    [episodeId]
  );

  const row = r.rows[0] as { open_work_intents: number; pending_phases: number };
  const openWorkIntents = Number(row.open_work_intents ?? 0);
  const pendingPhases = Number(row.pending_phases ?? 0);
  const needsFullChainBooking = chainBookingRequiredFromCounts(openWorkIntents, pendingPhases);

  return NextResponse.json({
    episodeId,
    openWorkIntents,
    pendingWorkPhases: pendingPhases,
    needsFullChainBooking,
  });
});
