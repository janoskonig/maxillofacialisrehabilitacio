import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import {
  APPOINTMENT_STATUS_VALUES,
  parseAppointmentStatus,
} from '@/lib/appointment-status';
import { SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT } from '@/lib/active-appointment';

export const dynamic = 'force-dynamic';

export const PATCH = roleHandler(['admin', 'fogpótlástanász', 'beutalo_orvos'], async (req, { auth, params }) => {
  const appointmentId = params.id;
  const body = await req.json();
  const { appointmentStatus, completionNotes, isLate, appointmentType } = body;

  // Pipe through the canonical taxonomy guard so any new status value added to
  // the SQL CHECK constraint requires updating lib/appointment-status.ts AND
  // the test suite in lockstep — preventing drift.
  const parsed = parseAppointmentStatus(appointmentStatus);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: `Érvénytelen státusz érték. Engedélyezett: ${APPOINTMENT_STATUS_VALUES.join(', ')} vagy NULL.`,
        code: 'INVALID_APPOINTMENT_STATUS',
      },
      { status: 400 }
    );
  }
  const normalisedStatus = parsed.status;

  if (normalisedStatus === 'completed' && (!completionNotes || completionNotes.trim() === '')) {
    return NextResponse.json(
      { error: 'A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén' },
      { status: 400 }
    );
  }

  // Migration 029: a sikertelen-jelölés a dedikált
  // PATCH /api/appointments/:id/attempt-outcome endpointon megy, mert ott
  // kötelező az indok, és ott történik az episode_work_phases visszaforgatása
  // pending-be (hogy új próba foglalható legyen). Itt elutasítjuk, nehogy
  // valaki indok nélkül állítsa át.
  if (normalisedStatus === 'unsuccessful') {
    return NextResponse.json(
      {
        error:
          'A sikertelen-jelölés a PATCH /api/appointments/:id/attempt-outcome végponton mehet, mert kötelező hozzá indok és a munkafázis visszaállítása.',
        code: 'USE_ATTEMPT_OUTCOME_ENDPOINT',
      },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  await pool.query('BEGIN');
  try {
    const appointmentResult = await pool.query(
      `SELECT id,
              appointment_status AS "appointmentStatus",
              episode_id         AS "episodeId",
              step_code          AS "stepCode",
              work_phase_id      AS "workPhaseId"
       FROM appointments WHERE id = $1 FOR UPDATE`,
      [appointmentId]
    );

    if (appointmentResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const apptBefore = appointmentResult.rows[0];
    const oldStatus = apptBefore.appointmentStatus ?? null;
    const episodeIdForEwp: string | null = apptBefore.episodeId ?? null;
    const stepCodeForEwp: string | null = apptBefore.stepCode ?? null;
    const workPhaseIdForEwp: string | null = apptBefore.workPhaseId ?? null;

    const updateFields: string[] = [];
    const updateValues: unknown[] = [];
    let paramIndex = 1;

    if (appointmentStatus !== undefined) {
      updateFields.push(`appointment_status = $${paramIndex}`);
      updateValues.push(normalisedStatus);
      paramIndex++;
    }

    if (completionNotes !== undefined) {
      updateFields.push(`completion_notes = $${paramIndex}`);
      updateValues.push(completionNotes && completionNotes.trim() !== '' ? completionNotes.trim() : null);
      paramIndex++;
    }

    if (isLate !== undefined) {
      updateFields.push(`is_late = $${paramIndex}`);
      updateValues.push(isLate === true);
      paramIndex++;
    }

    if (appointmentType !== undefined) {
      if (appointmentType !== null && appointmentType !== undefined) {
        const validTypes = ['elso_konzultacio', 'munkafazis', 'kontroll'];
        if (!validTypes.includes(appointmentType)) {
          await pool.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Érvénytelen időpont típus érték' },
            { status: 400 }
          );
        }
      }
      updateFields.push(`appointment_type = $${paramIndex}`);
      updateValues.push(appointmentType || null);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Nincs módosítandó mező' },
        { status: 400 }
      );
    }

    updateValues.push(appointmentId);

    const updateResult = await pool.query(
      `UPDATE appointments 
     SET ${updateFields.join(', ')} 
     WHERE id = $${paramIndex}
     RETURNING 
       id,
       appointment_status as "appointmentStatus",
       completion_notes as "completionNotes",
       is_late as "isLate",
       appointment_type as "appointmentType"`,
      updateValues
    );

    const appointment = updateResult.rows[0];
    if (!appointment) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Az időpont frissítése sikertelen volt (adatbázis nem adott vissza eredményt)' },
        { status: 500 }
      );
    }

    if (appointmentStatus !== undefined) {
      const newStatus = appointment.appointmentStatus;
      if (newStatus !== undefined && newStatus !== null) {
        const createdBy = auth.email ?? auth.userId ?? 'unknown';
        await pool.query(
          `INSERT INTO appointment_status_events (appointment_id, old_status, new_status, created_by)
           VALUES ($1, $2, $3, $4)`,
          [appointmentId, oldStatus, newStatus, createdBy]
        );
      } else {
        console.warn('[appointment_status_events] Skipping emit: UPDATE succeeded but RETURNING did not contain appointmentStatus', { appointmentId });
      }
    }

    // "Inactive or no-show" → expire the converted slot intent and reproject
    // remaining steps. Mirror of the canonical guard list in
    // lib/active-appointment.ts (cancelled set + no_show, since no_show should
    // also kick off reprojection even if it doesn't free the partial-unique slot).
    const isCancelOrNoShow =
      normalisedStatus === 'cancelled_by_doctor' ||
      normalisedStatus === 'cancelled_by_patient' ||
      normalisedStatus === 'no_show';

    if (isCancelOrNoShow) {
      // Ha az időpont korábban `completed` volt, és az EWP ehhez az appointmenthez
      // kötődött (completed vagy scheduled + appointment_id), a fázist visszanyitjuk
      // `pending`-re — különben „completed” fázis + lemondott időpont inkonzisztencia.
      if (
        oldStatus === 'completed' &&
        episodeIdForEwp &&
        stepCodeForEwp
      ) {
        let ewpId: string | null = workPhaseIdForEwp;
        let ewpStatus: string | null = null;
        let ewpApptId: string | null = null;

        if (!ewpId) {
          const ewpLookup = await pool.query(
            `SELECT id, status, appointment_id AS "appointmentId"
             FROM episode_work_phases
             WHERE episode_id = $1 AND work_phase_code = $2
               AND (
                 NOT EXISTS (
                   SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
                     AND column_name = 'merged_into_episode_work_phase_id'
                 )
                 OR merged_into_episode_work_phase_id IS NULL
               )
             FOR UPDATE`,
            [episodeIdForEwp, stepCodeForEwp]
          );
          if (ewpLookup.rows.length === 1) {
            ewpId = ewpLookup.rows[0].id;
            ewpStatus = ewpLookup.rows[0].status ?? null;
            ewpApptId = ewpLookup.rows[0].appointmentId ?? null;
          }
        } else {
          const ewpRow = await pool.query(
            `SELECT status, appointment_id AS "appointmentId"
             FROM episode_work_phases WHERE id = $1 FOR UPDATE`,
            [ewpId]
          );
          ewpStatus = ewpRow.rows[0]?.status ?? null;
          ewpApptId = ewpRow.rows[0]?.appointmentId ?? null;
        }

        if (
          ewpId &&
          ewpApptId === appointmentId &&
          (ewpStatus === 'completed' || ewpStatus === 'scheduled')
        ) {
          const otherActive = await pool.query(
            `SELECT 1 FROM appointments a
             WHERE a.episode_id = $1
               AND a.step_code = $2
               AND a.id <> $3
               AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
             LIMIT 1`,
            [episodeIdForEwp, stepCodeForEwp, appointmentId]
          );
          if (otherActive.rows.length === 0) {
            const changedBy = auth.email ?? auth.userId ?? 'unknown';
            await pool.query(
              `UPDATE episode_work_phases
               SET status = 'pending', appointment_id = NULL
               WHERE id = $1`,
              [ewpId]
            );
            await pool.query(
              `INSERT INTO episode_work_phase_audit
                 (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                ewpId,
                episodeIdForEwp,
                ewpStatus,
                'pending',
                changedBy,
                `appointment ${appointmentId} státusza ${normalisedStatus}-re változott (utólagos jelölés) — fázis visszanyitva`,
              ]
            );
          }
        }
      }

      await pool.query(
        `UPDATE slot_intents si
         SET state = 'expired', updated_at = CURRENT_TIMESTAMP
         FROM appointments a
         WHERE a.id = $1
           AND a.slot_intent_id = si.id
           AND si.state = 'converted'`,
        [appointmentId]
      );

      // Slot-state ↔ appointment_status szinkron (W: bulk-convert robustness).
      // A cancelled_by_* megsz\u00fcntet\u00e9s mostm\u00e1r felszabad\u00edtja a slotot is, hogy a
      // bulk-convert / individual booking flow \u00fajra haszn\u00e1lhassa. A `no_show`-ra
      // direkt NEM nyúlunk: a kanonikus taxonómia (lib/active-appointment.ts:23-25)
      // szerint a no_show "active" — a slotot foglaltnak tekintjük, mert az
      // időpont valós időben "elkelt" (a beteg nem jött el, de a slot már nem
      // adható másnak ugyanarra az időre).
      if (
        normalisedStatus === 'cancelled_by_doctor' ||
        normalisedStatus === 'cancelled_by_patient'
      ) {
        await pool.query(
          `UPDATE available_time_slots ats
              SET state = 'free', status = 'available'
              FROM appointments a
              WHERE a.id = $1
                AND a.time_slot_id = ats.id`,
          [appointmentId]
        );
      }

      const epRow = await pool.query(
        'SELECT episode_id FROM appointments WHERE id = $1',
        [appointmentId]
      );
      const episodeId = epRow.rows[0]?.episode_id;
      if (episodeId) {
        await pool.query(
          `INSERT INTO scheduling_events (entity_type, entity_id, event_type) VALUES ('episode', $1, 'REPROJECT_INTENTS')`,
          [episodeId]
        );
      }
    }

    await pool.query('COMMIT');

    if (appointmentStatus !== undefined) {
      try {
        await emitSchedulingEvent('appointment', appointmentId, 'status_changed');
      } catch {
        // Non-blocking
      }
    }

    return NextResponse.json({ 
      appointment
    }, { status: 200 });
  } catch (txError) {
    await pool.query('ROLLBACK');
    throw txError;
  }
});
