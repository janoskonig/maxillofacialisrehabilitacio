import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getFullStepQuery } from '@/lib/episode-step-select';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/steps/:stepId/unmerge
 * Unmerge: remove all steps merged into the given primary step,
 * making them independent steps again.
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const stepId = params.stepId;

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
    `UPDATE episode_steps SET merged_into_episode_step_id = NULL
     WHERE merged_into_episode_step_id = $1 AND episode_id = $2
     RETURNING id`,
    [stepId, episodeId]
  );

  if (updated.rows.length === 0) {
    return NextResponse.json({ error: 'Nincs összevont lépés ehhez a fő lépéshez' }, { status: 404 });
  }

  try {
    await emitSchedulingEvent('episode', episodeId, 'steps_unmerged');
  } catch { /* non-blocking */ }

  const allSteps = await getFullStepQuery(pool, episodeId);
  return NextResponse.json({ steps: allSteps.rows });
});
