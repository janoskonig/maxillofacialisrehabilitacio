import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { createEpisodeVisit } from '@/lib/episode-visits';

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
    return NextResponse.json({ error: 'Csak aktív epizód munkafázisai bonthatók szét' }, { status: 400 });
  }

  // A szétbontás és a 'unmerge' audit sorok (WP-2.1) EGY tranzakcióban,
  // hogy a napló ne maradhasson le a mutációról.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const primaryRow = await client.query(
      `SELECT work_phase_code FROM episode_work_phases WHERE id = $1 AND episode_id = $2`,
      [workPhaseId, episodeId]
    );
    const primaryCode: string = primaryRow.rows[0]?.work_phase_code ?? workPhaseId;

    const updated = await client.query(
      `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = NULL
       WHERE merged_into_episode_work_phase_id = $1 AND episode_id = $2
       RETURNING id, status, default_days_offset`,
      [workPhaseId, episodeId]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Nincs összevont munkafázis ehhez a fő munkafázishoz' }, { status: 404 });
    }

    // WP-4.1a: a kiengedett fázis új egyfős vizitet kap a vizit-lista végére
    // (a primary vizitjében csak a primary és az ott maradó tagok maradnak).
    for (const row of updated.rows as Array<{ id: string; default_days_offset: number | null }>) {
      const visit = await createEpisodeVisit(client, {
        episodeId,
        daysOffset: row.default_days_offset ?? null,
      });
      await client.query(`UPDATE episode_work_phases SET visit_id = $1 WHERE id = $2`, [
        visit.id,
        row.id,
      ]);
    }

    for (const row of updated.rows as Array<{ id: string; status: string }>) {
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: row.id,
        episodeId,
        oldStatus: row.status,
        newStatus: row.status,
        changedBy: auth.email ?? auth.userId ?? 'unknown',
        changeType: 'unmerge',
        reason: `Szétbontva a(z) ${primaryCode} fázis alól`,
      });
    }

    await client.query('COMMIT');
  } catch (txError) {
    await client.query('ROLLBACK').catch(() => {});
    throw txError;
  } finally {
    client.release();
  }

  try {
    await emitSchedulingEvent('episode', episodeId, 'steps_unmerged');
  } catch {
    /* non-blocking */
  }

  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);
  return NextResponse.json({ workPhases: allPhases.rows });
});
