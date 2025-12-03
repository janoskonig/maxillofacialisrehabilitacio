import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';

// Update appointment status
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
    const { appointmentStatus, completionNotes, isLate } = body;

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

    // Check if appointment exists
    const appointmentResult = await pool.query(
      'SELECT id FROM appointments WHERE id = $1',
      [appointmentId]
    );

    if (appointmentResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

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

    if (updateFields.length === 0) {
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
         is_late as "isLate"`,
      updateValues
    );

    return NextResponse.json({ 
      appointment: updateResult.rows[0]
    }, { status: 200 });
  } catch (error) {
    return handleApiError(error, 'Hiba történt az időpont státuszának frissítésekor');
  }
}





