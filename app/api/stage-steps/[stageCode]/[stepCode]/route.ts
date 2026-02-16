import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

function requireAdmin(auth: { role?: string } | null) {
  if (!auth) return { error: 'Bejelentkezés szükséges', status: 401 as const };
  if (auth.role !== 'admin') return { error: 'Nincs jogosultság', status: 403 as const };
  return null;
}

/**
 * PATCH /api/stage-steps/[stageCode]/[stepCode] — order_index frissítés: { orderIndex }
 * Admin-only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ stageCode: string; stepCode: string }> }
) {
  try {
    const auth = await verifyAuth(request);
    const err = requireAdmin(auth);
    if (err) return NextResponse.json({ error: err.error }, { status: err.status });

    const { stageCode, stepCode } = await params;
    const body = await request.json();
    const orderIndex = typeof body.orderIndex === 'number' ? body.orderIndex : 0;

    const pool = getDbPool();

    try {
      const result = await pool.query(
        `UPDATE stage_steps SET order_index = $1
         WHERE stage_code = $2 AND step_code = $3
         RETURNING stage_code as "stageCode", step_code as "stepCode", order_index as "orderIndex"`,
        [orderIndex, stageCode, stepCode]
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Kapcsolat nem található' },
          { status: 404 }
        );
      }

      return NextResponse.json({ item: result.rows[0] });
    } catch (dbErr: unknown) {
      const msg = String(dbErr ?? '');
      if (msg.includes('uq_stage_steps_stage_order') || msg.includes('unique') || msg.includes('duplicate')) {
        return NextResponse.json(
          { error: 'orderIndex ütközik ezen stage-en belül. Válasszon másik orderIndex-et.', code: 'ORDER_INDEX_CONFLICT' },
          { status: 409 }
        );
      }
      throw dbErr;
    }
  } catch (error) {
    console.error('Error updating stage-step:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kapcsolat frissítésekor' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/stage-steps/[stageCode]/[stepCode] — kapcsolat törlése
 * Admin-only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ stageCode: string; stepCode: string }> }
) {
  try {
    const auth = await verifyAuth(request);
    const err = requireAdmin(auth);
    if (err) return NextResponse.json({ error: err.error }, { status: err.status });

    const { stageCode, stepCode } = await params;
    const pool = getDbPool();

    const result = await pool.query(
      `DELETE FROM stage_steps WHERE stage_code = $1 AND step_code = $2
       RETURNING stage_code, step_code`,
      [stageCode, stepCode]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Kapcsolat nem található' },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting stage-step:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kapcsolat törlésekor' },
      { status: 500 }
    );
  }
}
