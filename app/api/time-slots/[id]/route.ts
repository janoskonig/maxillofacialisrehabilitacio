import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Update a time slot
export async function PUT(
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

    const pool = getDbPool();

    // Check if time slot exists and belongs to the user (if fogpótlástanász)
    const timeSlotResult = await pool.query(
      `SELECT ats.*, u.email as user_email
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       WHERE ats.id = $1`,
      [params.id]
    );

    if (timeSlotResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const timeSlot = timeSlotResult.rows[0];

    // Only fogpótlástanász can update their own time slots, or admin
    if (auth.role === 'fogpótlástanász' && timeSlot.user_email !== auth.email) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ezt az időpontot módosítani' },
        { status: 403 }
      );
    }

    if (auth.role !== 'fogpótlástanász' && auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az időpont módosításához' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { startTime, status, cim, teremszam } = body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (startTime !== undefined) {
      const startDate = new Date(startTime);
      const now = new Date();

      // Validate that start time is in the future
      if (startDate <= now) {
        return NextResponse.json(
          { error: 'Az időpont csak jövőbeli dátum lehet' },
          { status: 400 }
        );
      }

      updates.push(`start_time = $${paramIndex}`);
      values.push(startDate.toISOString());
      paramIndex++;
    }

    if (status !== undefined) {
      if (!['available', 'booked'].includes(status)) {
        return NextResponse.json(
          { error: 'Érvénytelen státusz' },
          { status: 400 }
        );
      }
      updates.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (cim !== undefined) {
      updates.push(`cim = $${paramIndex}`);
      values.push(cim || null);
      paramIndex++;
    }

    if (teremszam !== undefined) {
      updates.push(`teremszam = $${paramIndex}`);
      values.push(teremszam || null);
      paramIndex++;
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'Nincs módosítandó mező' },
        { status: 400 }
      );
    }

    values.push(params.id);
    const query = `
      UPDATE available_time_slots 
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $${paramIndex}
      RETURNING 
        id,
        start_time as "startTime",
        status,
        cim,
        teremszam,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    const result = await pool.query(query, values);
    return NextResponse.json({ timeSlot: result.rows[0] });
  } catch (error) {
    console.error('Error updating time slot:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont frissítésekor' },
      { status: 500 }
    );
  }
}

// Delete a time slot
export async function DELETE(
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

    const pool = getDbPool();

    // Check if time slot exists and belongs to the user (if fogpótlástanász)
    const timeSlotResult = await pool.query(
      `SELECT ats.*, u.email as user_email
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       WHERE ats.id = $1`,
      [params.id]
    );

    if (timeSlotResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const timeSlot = timeSlotResult.rows[0];

    // Only fogpótlástanász can delete their own time slots, or admin
    if (auth.role === 'fogpótlástanász' && timeSlot.user_email !== auth.email) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ezt az időpontot törölni' },
        { status: 403 }
      );
    }

    if (auth.role !== 'fogpótlástanász' && auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az időpont törléséhez' },
        { status: 403 }
      );
    }

    // Check if time slot is booked
    if (timeSlot.status === 'booked') {
      return NextResponse.json(
        { error: 'Nem lehet törölni egy lefoglalt időpontot' },
        { status: 400 }
      );
    }

    await pool.query('DELETE FROM available_time_slots WHERE id = $1', [params.id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting time slot:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont törlésekor' },
      { status: 500 }
    );
  }
}

