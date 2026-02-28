import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const PUT = authedHandler(async (req, { auth, params }) => {
  const { id } = params;
  const pool = getDbPool();

  const timeSlotResult = await pool.query(
    `SELECT ats.*, u.email as user_email
     FROM available_time_slots ats
     JOIN users u ON ats.user_id = u.id
     WHERE ats.id = $1`,
    [id]
  );

  if (timeSlotResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Időpont nem található' },
      { status: 404 }
    );
  }

  const existingTimeSlot = timeSlotResult.rows[0];

  if (auth.role === 'fogpótlástanász' && existingTimeSlot.user_email !== auth.email) {
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

  const body = await req.json();
  const { startTime, status, cim, teremszam } = body;

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (startTime !== undefined) {
    const startDate = new Date(startTime);
    const now = new Date();

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

  values.push(id);
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
  
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const timeSlot = {
    ...result.rows[0],
    cim: result.rows[0].cim || DEFAULT_CIM,
  };
  
  return NextResponse.json({ timeSlot });
});

export const DELETE = authedHandler(async (req, { auth, params }) => {
  const { id } = params;
  const pool = getDbPool();

  const timeSlotResult = await pool.query(
    `SELECT ats.*, u.email as user_email
     FROM available_time_slots ats
     JOIN users u ON ats.user_id = u.id
     WHERE ats.id = $1`,
    [id]
  );

  if (timeSlotResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Időpont nem található' },
      { status: 404 }
    );
  }

  const timeSlot = timeSlotResult.rows[0];

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

  if (timeSlot.status === 'booked') {
    return NextResponse.json(
      { error: 'Nem lehet törölni egy lefoglalt időpontot' },
      { status: 400 }
    );
  }

  await pool.query('DELETE FROM available_time_slots WHERE id = $1', [id]);

  return NextResponse.json({ success: true });
});
