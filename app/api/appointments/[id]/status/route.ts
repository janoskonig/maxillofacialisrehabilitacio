import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';

export const dynamic = 'force-dynamic';

export const PATCH = roleHandler(['admin', 'fogpótlástanász', 'sebészorvos'], async (req, { auth, params }) => {
  const appointmentId = params.id;
  const body = await req.json();
  const { appointmentStatus, completionNotes, isLate, appointmentType } = body;

  if (appointmentStatus !== null && appointmentStatus !== undefined) {
    const validStatuses = ['cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show'];
    if (!validStatuses.includes(appointmentStatus)) {
      return NextResponse.json(
        { error: 'Érvénytelen státusz érték' },
        { status: 400 }
      );
    }
  }

  if (appointmentStatus === 'completed' && (!completionNotes || completionNotes.trim() === '')) {
    return NextResponse.json(
      { error: 'A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  await pool.query('BEGIN');
  try {
    const appointmentResult = await pool.query(
      'SELECT id, appointment_status as "appointmentStatus" FROM appointments WHERE id = $1 FOR UPDATE',
      [appointmentId]
    );

    if (appointmentResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const oldStatus = appointmentResult.rows[0].appointmentStatus ?? null;

    const updateFields: string[] = [];
    const updateValues: unknown[] = [];
    let paramIndex = 1;

    if (appointmentStatus !== undefined) {
      updateFields.push(`appointment_status = $${paramIndex}`);
      updateValues.push(appointmentStatus);
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

    const isCancelOrNoShow = appointmentStatus !== undefined &&
      ['cancelled_by_doctor', 'cancelled_by_patient', 'no_show'].includes(appointmentStatus);

    if (isCancelOrNoShow) {
      await pool.query(
        `UPDATE slot_intents si
         SET state = 'expired', updated_at = CURRENT_TIMESTAMP
         FROM appointments a
         WHERE a.id = $1
           AND a.slot_intent_id = si.id
           AND si.state = 'converted'`,
        [appointmentId]
      );

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
