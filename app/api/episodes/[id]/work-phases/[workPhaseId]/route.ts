import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import {
  EPISODE_WORK_PHASE_SELECT_COLUMNS,
  getToothTreatmentJoin,
  getToothTreatmentSelectCols,
} from '@/lib/episode-work-phase-select';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/episodes/:id/work-phases/:workPhaseId
 */
export const DELETE = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const workPhaseId = params.workPhaseId;
  const pool = getDbPool();

  await pool.query('BEGIN');
  try {
    const row = await pool.query(
      `SELECT ewp.id, ewp.episode_id, ewp.work_phase_code, ewp.status,
              pe.status as episode_status
       FROM episode_work_phases ewp
       JOIN patient_episodes pe ON ewp.episode_id = pe.id
       WHERE ewp.id = $1 AND ewp.episode_id = $2
       FOR UPDATE OF ewp`,
      [workPhaseId, episodeId]
    );

    if (row.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json({ error: 'Munkafázis nem található' }, { status: 404 });
    }

    const phase = row.rows[0];

    if (phase.episode_status !== 'open') {
      await pool.query('ROLLBACK');
      return NextResponse.json({ error: 'Csak aktív epizód munkafázisai törölhetők' }, { status: 400 });
    }

    if (phase.status !== 'pending' && phase.status !== 'skipped') {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: `Csak várakozó (pending) vagy átugrott (skipped) munkafázis hagyható el. Jelenlegi státusz: ${phase.status}` },
        { status: 400 }
      );
    }

    await pool.query(
      `INSERT INTO episode_work_phase_audit (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [workPhaseId, episodeId, phase.status, 'deleted', auth.email ?? auth.userId ?? 'unknown', 'Manuálisan törölve']
    );

    await pool.query(`DELETE FROM episode_work_phases WHERE id = $1`, [workPhaseId]);

    await pool.query(
      `WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY COALESCE(seq, pathway_order_index)) - 1 as new_seq
        FROM episode_work_phases WHERE episode_id = $1
      )
      UPDATE episode_work_phases SET seq = numbered.new_seq
      FROM numbered WHERE episode_work_phases.id = numbered.id`,
      [episodeId]
    );

    await pool.query('COMMIT');

    try {
      await emitSchedulingEvent('episode', episodeId, 'step_deleted');
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ deleted: true, workPhaseId });
  } catch (txError) {
    await pool.query('ROLLBACK');
    throw txError;
  }
});

/**
 * PATCH /api/episodes/:id/work-phases/:workPhaseId
 */
export const PATCH = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const workPhaseId = params.workPhaseId;
  const body = await req.json();
  const { status: newStatus, reason, defaultDaysOffset, durationMinutes, customLabel } = body;

  const pool = getDbPool();

  const isTimingOnly =
    newStatus === undefined &&
    (defaultDaysOffset !== undefined || durationMinutes !== undefined || customLabel !== undefined);

  await pool.query('BEGIN');
  try {
    const phaseRow = await pool.query(
      `SELECT ewp.id, ewp.episode_id, ewp.work_phase_code, ewp.status, ewp.pathway_order_index,
              pe.status as episode_status
       FROM episode_work_phases ewp
       JOIN patient_episodes pe ON ewp.episode_id = pe.id
       WHERE ewp.id = $1 AND ewp.episode_id = $2
       FOR UPDATE OF ewp`,
      [workPhaseId, episodeId]
    );

    if (phaseRow.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json({ error: 'Munkafázis nem található' }, { status: 404 });
    }

    const phase = phaseRow.rows[0];

    if (phase.episode_status !== 'open') {
      await pool.query('ROLLBACK');
      return NextResponse.json({ error: 'Csak aktív epizód munkafázisai módosíthatók' }, { status: 400 });
    }

    if (isTimingOnly) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let pi = 1;

      if (typeof defaultDaysOffset === 'number' && defaultDaysOffset >= 0) {
        sets.push(`default_days_offset = $${pi++}`);
        vals.push(defaultDaysOffset);
      }
      if (typeof durationMinutes === 'number' && durationMinutes > 0) {
        sets.push(`duration_minutes = $${pi++}`);
        vals.push(durationMinutes);
      }
      if (typeof customLabel === 'string') {
        sets.push(`custom_label = $${pi++}`);
        vals.push(customLabel.trim() || null);
      }

      if (sets.length > 0) {
        vals.push(workPhaseId);
        await pool.query(`UPDATE episode_work_phases SET ${sets.join(', ')} WHERE id = $${pi}`, vals);
      }

      await pool.query('COMMIT');

      try {
        await emitSchedulingEvent('episode', episodeId, 'step_timing_updated');
      } catch {
        /* non-blocking */
      }
    } else if (phase.status === 'completed' && newStatus === 'pending') {
      if (typeof reason !== 'string' || reason.trim().length < 5) {
        await pool.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Az újranyitáshoz indoklás szükséges (legalább 5 karakter).' },
          { status: 400 }
        );
      }

      const stepCode = phase.work_phase_code as string;

      await pool.query(
        `UPDATE episode_work_phases SET status = 'pending', completed_at = NULL WHERE id = $1`,
        [workPhaseId]
      );

      await pool.query(
        `INSERT INTO episode_work_phase_audit (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [workPhaseId, episodeId, 'completed', 'pending', auth.email ?? auth.userId ?? 'unknown', reason.trim()]
      );

      const futureAppts = await pool.query(
        `SELECT id, time_slot_id FROM appointments
         WHERE episode_id = $1 AND step_code = $2
         AND start_time > CURRENT_TIMESTAMP
         AND (appointment_status IS NULL OR appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))`,
        [episodeId, stepCode]
      );
      for (const ap of futureAppts.rows as Array<{ id: string; time_slot_id: string | null }>) {
        await pool.query(`UPDATE appointments SET appointment_status = 'cancelled_by_doctor' WHERE id = $1`, [ap.id]);
        if (ap.time_slot_id) {
          await pool.query(
            `UPDATE available_time_slots SET state = 'free', status = 'available' WHERE id = $1`,
            [ap.time_slot_id]
          );
        }
      }

      await pool.query(
        `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE episode_id = $1 AND step_code = $2 AND state = 'open'`,
        [episodeId, stepCode]
      );

      await pool.query('COMMIT');

      try {
        await projectRemainingSteps(episodeId);
      } catch {
        /* non-blocking */
      }
      try {
        await emitSchedulingEvent('episode', episodeId, 'step_reopened');
      } catch {
        /* non-blocking */
      }

      const ttJoin = getToothTreatmentJoin();
      const ttCols = getToothTreatmentSelectCols();
      const updated = await pool.query(
        `SELECT ${EPISODE_WORK_PHASE_SELECT_COLUMNS}${ttCols} FROM episode_work_phases ewp ${ttJoin} WHERE ewp.id = $1`,
        [workPhaseId]
      );

      return NextResponse.json({ workPhase: updated.rows[0] });
    } else {
      const validTransitions: Record<string, string[]> = {
        pending: ['skipped', 'completed'],
        scheduled: ['skipped', 'completed'],
        skipped: ['pending'],
        completed: [],
      };

      const allowed = validTransitions[phase.status];
      if (!allowed || !allowed.includes(newStatus)) {
        await pool.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Nem lehetséges: ${phase.status} → ${newStatus}`,
            currentStatus: phase.status,
            allowedTransitions: allowed ?? [],
          },
          { status: 400 }
        );
      }

      const completedAt =
        newStatus === 'skipped' || newStatus === 'completed' ? new Date().toISOString() : null;

      await pool.query(`UPDATE episode_work_phases SET status = $1, completed_at = $2 WHERE id = $3`, [
        newStatus,
        completedAt,
        workPhaseId,
      ]);

      await pool.query(
        `INSERT INTO episode_work_phase_audit (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [workPhaseId, episodeId, phase.status, newStatus, auth.email ?? auth.userId ?? 'unknown', reason ?? null]
      );

      await pool.query('COMMIT');

      try {
        await emitSchedulingEvent(
          'episode',
          episodeId,
          newStatus === 'completed' ? 'step_completed' : 'step_skipped'
        );
      } catch {
        /* non-blocking */
      }
    }

    const ttJoin = getToothTreatmentJoin();
    const ttCols = getToothTreatmentSelectCols();
    const updated = await pool.query(
      `SELECT ${EPISODE_WORK_PHASE_SELECT_COLUMNS}${ttCols} FROM episode_work_phases ewp ${ttJoin} WHERE ewp.id = $1`,
      [workPhaseId]
    );

    return NextResponse.json({ workPhase: updated.rows[0] });
  } catch (txError) {
    await pool.query('ROLLBACK');
    throw txError;
  }
});
