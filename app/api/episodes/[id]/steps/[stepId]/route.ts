import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { emitSchedulingEvent } from '@/lib/scheduling-events';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/episodes/:id/steps/:stepId
 * Remove a pending step from the episode. Only pending steps can be deleted.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; stepId: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const allowedRoles = ['admin', 'sebészorvos', 'fogpótlástanász'];
    if (!allowedRoles.includes(auth.role ?? '')) {
      return NextResponse.json({ error: 'Nincs jogosultsága' }, { status: 403 });
    }

    const episodeId = params.id;
    const stepId = params.stepId;
    const pool = getDbPool();

    await pool.query('BEGIN');
    try {
      const stepRow = await pool.query(
        `SELECT es.id, es.episode_id, es.step_code, es.status,
                pe.status as episode_status
         FROM episode_steps es
         JOIN patient_episodes pe ON es.episode_id = pe.id
         WHERE es.id = $1 AND es.episode_id = $2
         FOR UPDATE OF es`,
        [stepId, episodeId]
      );

      if (stepRow.rows.length === 0) {
        await pool.query('ROLLBACK');
        return NextResponse.json({ error: 'Lépés nem található' }, { status: 404 });
      }

      const step = stepRow.rows[0];

      if (step.episode_status !== 'open') {
        await pool.query('ROLLBACK');
        return NextResponse.json({ error: 'Csak aktív epizód lépései törölhetők' }, { status: 400 });
      }

      if (step.status !== 'pending' && step.status !== 'skipped') {
        await pool.query('ROLLBACK');
        return NextResponse.json(
          { error: `Csak várakozó (pending) vagy átugrott (skipped) lépés hagyható el. Jelenlegi státusz: ${step.status}` },
          { status: 400 }
        );
      }

      await pool.query(
        `INSERT INTO episode_step_audit (episode_step_id, episode_id, old_status, new_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [stepId, episodeId, step.status, 'deleted', auth.email ?? auth.userId ?? 'unknown', 'Manuálisan törölve']
      );

      await pool.query(`DELETE FROM episode_steps WHERE id = $1`, [stepId]);

      // Re-sequence remaining steps
      await pool.query(
        `WITH numbered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY COALESCE(seq, pathway_order_index)) - 1 as new_seq
          FROM episode_steps WHERE episode_id = $1
        )
        UPDATE episode_steps SET seq = numbered.new_seq
        FROM numbered WHERE episode_steps.id = numbered.id`,
        [episodeId]
      );

      await pool.query('COMMIT');

      try {
        await emitSchedulingEvent('episode', episodeId, 'step_deleted');
      } catch { /* non-blocking */ }

      return NextResponse.json({ deleted: true, stepId });
    } catch (txError) {
      await pool.query('ROLLBACK');
      throw txError;
    }
  } catch (error) {
    console.error('Error in DELETE /episodes/:id/steps/:stepId:', error);
    return NextResponse.json(
      { error: 'Hiba történt a lépés törlésekor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/episodes/:id/steps/:stepId
 * Update episode step status. Primary use case: skip/unskip a step manually.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; stepId: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const allowedRoles = ['admin', 'sebészorvos', 'fogpótlástanász'];
    if (!allowedRoles.includes(auth.role ?? '')) {
      return NextResponse.json({ error: 'Nincs jogosultsága' }, { status: 403 });
    }

    const episodeId = params.id;
    const stepId = params.stepId;
    const body = await request.json();
    const { status: newStatus, reason } = body;

    const validTransitions: Record<string, string[]> = {
      pending: ['skipped'],
      scheduled: ['skipped'],
      skipped: ['pending'],
      completed: [],
    };

    const pool = getDbPool();

    await pool.query('BEGIN');
    try {
      const stepRow = await pool.query(
        `SELECT es.id, es.episode_id, es.step_code, es.status, es.pathway_order_index,
                pe.status as episode_status
         FROM episode_steps es
         JOIN patient_episodes pe ON es.episode_id = pe.id
         WHERE es.id = $1 AND es.episode_id = $2
         FOR UPDATE OF es`,
        [stepId, episodeId]
      );

      if (stepRow.rows.length === 0) {
        await pool.query('ROLLBACK');
        return NextResponse.json({ error: 'Lépés nem található' }, { status: 404 });
      }

      const step = stepRow.rows[0];

      if (step.episode_status !== 'open') {
        await pool.query('ROLLBACK');
        return NextResponse.json({ error: 'Csak aktív epizód lépései módosíthatók' }, { status: 400 });
      }

      const allowed = validTransitions[step.status];
      if (!allowed || !allowed.includes(newStatus)) {
        await pool.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Nem lehetséges: ${step.status} → ${newStatus}`,
            currentStatus: step.status,
            allowedTransitions: allowed ?? [],
          },
          { status: 400 }
        );
      }

      const completedAt = newStatus === 'skipped' ? new Date().toISOString() : null;

      await pool.query(
        `UPDATE episode_steps SET status = $1, completed_at = $2 WHERE id = $3`,
        [newStatus, completedAt, stepId]
      );

      await pool.query(
        `INSERT INTO episode_step_audit (episode_step_id, episode_id, old_status, new_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [stepId, episodeId, step.status, newStatus, auth.email ?? auth.userId ?? 'unknown', reason ?? null]
      );

      await pool.query('COMMIT');

      // Refresh next-step cache (non-blocking)
      try {
        await emitSchedulingEvent('episode', episodeId, 'step_skipped');
      } catch { /* non-blocking */ }

      const updated = await pool.query(
        `SELECT id, episode_id as "episodeId", step_code as "stepCode",
                pathway_order_index as "pathwayOrderIndex", pool,
                duration_minutes as "durationMinutes",
                default_days_offset as "defaultDaysOffset",
                status, appointment_id as "appointmentId",
                created_at as "createdAt", completed_at as "completedAt",
                source_episode_pathway_id as "sourceEpisodePathwayId", seq,
                custom_label as "customLabel"
         FROM episode_steps WHERE id = $1`,
        [stepId]
      );

      return NextResponse.json({ step: updated.rows[0] });
    } catch (txError) {
      await pool.query('ROLLBACK');
      throw txError;
    }
  } catch (error) {
    console.error('Error in PATCH /episodes/:id/steps/:stepId:', error);
    return NextResponse.json(
      { error: 'Hiba történt a lépés frissítésekor' },
      { status: 500 }
    );
  }
}
