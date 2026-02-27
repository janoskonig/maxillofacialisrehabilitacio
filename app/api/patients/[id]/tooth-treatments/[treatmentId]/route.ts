import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/patients/:id/tooth-treatments/:treatmentId — update status, notes, mark completed
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; treatmentId: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (!['admin', 'sebészorvos', 'fogpótlástanász', 'editor'].includes(auth.role)) {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const pool = getDbPool();
    const { treatmentId } = params;
    const body = await request.json();

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.status !== undefined) {
      const validStatuses = ['pending', 'episode_linked', 'completed'];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json({ error: 'Érvénytelen státusz' }, { status: 400 });
      }
      updates.push(`status = $${idx++}`);
      values.push(body.status);
      if (body.status === 'completed') {
        updates.push(`completed_at = CURRENT_TIMESTAMP`);
      }
    }
    if (body.notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push((body.notes as string)?.trim() || null);
    }
    if (body.episodeId !== undefined) {
      updates.push(`episode_id = $${idx++}`);
      values.push(body.episodeId || null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nincs módosítandó mező' }, { status: 400 });
    }

    values.push(treatmentId);
    values.push(params.id);

    const result = await pool.query(
      `UPDATE tooth_treatments SET ${updates.join(', ')}
       WHERE id = $${idx} AND patient_id = $${idx + 1}
       RETURNING id, patient_id as "patientId", tooth_number as "toothNumber",
                 treatment_code as "treatmentCode", status, episode_id as "episodeId",
                 notes, created_by as "createdBy", created_at as "createdAt",
                 completed_at as "completedAt"`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Nem található' }, { status: 404 });
    }

    return NextResponse.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Error updating tooth treatment:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fog-kezelési igény frissítésekor' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/patients/:id/tooth-treatments/:treatmentId — delete (only pending)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; treatmentId: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (!['admin', 'sebészorvos', 'fogpótlástanász', 'editor'].includes(auth.role)) {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const pool = getDbPool();
    const { treatmentId } = params;

    const result = await pool.query(
      `DELETE FROM tooth_treatments
       WHERE id = $1 AND patient_id = $2 AND status = 'pending'
       RETURNING id`,
      [treatmentId, params.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Nem található, vagy nem pending státuszú (csak pending törölhető)' },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: treatmentId });
  } catch (error) {
    console.error('Error deleting tooth treatment:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fog-kezelési igény törlésekor' },
      { status: 500 }
    );
  }
}
