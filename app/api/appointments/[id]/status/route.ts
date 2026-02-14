import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';

// Update appointment status
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Only admin, fogpótlástanász, and sebészorvos can update appointment status
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász' && auth.role !== 'sebészorvos') {
      return NextResponse.json(
        { error: 'Nincs jogosultság az időpont státuszának módosításához' },
        { status: 403 }
      );
    }

    const appointmentId = params.id;
    const body = await request.json();
    const { appointmentStatus, completionNotes, isLate, appointmentType } = body;

    // Validate appointmentStatus if provided
    if (appointmentStatus !== null && appointmentStatus !== undefined) {
      const validStatuses = ['cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show'];
      if (!validStatuses.includes(appointmentStatus)) {
        return NextResponse.json(
          { error: 'Érvénytelen státusz érték' },
          { status: 400 }
        );
      }
    }

    // Validate completionNotes - required if status is 'completed'
    if (appointmentStatus === 'completed' && (!completionNotes || completionNotes.trim() === '')) {
      return NextResponse.json(
        { error: 'A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    await pool.query('BEGIN');
    try {
      // Lock appointment row and get current status (prevents race: correct oldStatus for audit)
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

      // Build update query dynamically
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
        // Validate appointmentType if provided
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

      // Add appointment ID to params
      updateValues.push(appointmentId);

      // Update appointment
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

      // Emit appointment_status_events for audit (immutable event log)
      // Use only DB result for newStatus — never fall back to request param (audit must reflect persisted state)
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

      await pool.query('COMMIT');
      return NextResponse.json({ 
        appointment
      }, { status: 200 });
    } catch (txError) {
      await pool.query('ROLLBACK');
      throw txError;
    }
  } catch (error) {
    return handleApiError(error, 'Hiba történt az időpont státuszának frissítésekor');
  }
}








