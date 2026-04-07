import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/work-phases/:workPhaseId/unmerge
 * Unmerge: remove all steps merged into the given primary step,
 * making them independent steps again.
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const workPhaseId = params.workPhaseId;

  const pool = getDbPool();

  const epRow = await pool.query(
    `SELECT pe.status FROM patient_episodes pe WHERE pe.id = $1`,
    [episodeId]
  );
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (epRow.rows[0].status !== 'open') {
    return NextResponse.json({ error: 'Csak aktív epizód lépései bonthatók szét' }, { status: 400 });
  }

  const updated = await pool.query(
    `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = NULL
     WHERE merged_into_episode_work_phase_id = $1 AND episode_id = $2
     RETURNING id`,
    [workPhaseId, episodeId]
  );

  if (updated.rows.length === 0) {
    return NextResponse.json({ error: 'Nincs összevont munkafázis ehhez a fő munkafázishoz' }, { status: 404 });
  }

  try {
    await emitSchedulingEvent('episode', episodeId, 'steps_unmerged');
  } catch {
    /* non-blocking */
  }

  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);
  return NextResponse.json({ workPhases: allPhases.rows });
});
