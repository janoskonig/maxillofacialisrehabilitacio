import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { treatmentTypePatchSchema } from '@/lib/admin-process-schemas';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/treatment-types/:id — update treatment type. code immutable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const id = params.id;
    const body = await request.json();
    const auditReason =
      body.auditReason ?? request.nextUrl.searchParams.get('auditReason');
    const parsed = treatmentTypePatchSchema.safeParse({ ...body, auditReason });
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const data = parsed.data;

    const pool = getDbPool();
    const r = await pool.query(
      `UPDATE treatment_types SET label_hu = $1 WHERE id = $2
       RETURNING id, code, label_hu as "labelHu"`,
      [data.labelHu, id]
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Kezeléstípus nem található' }, { status: 404 });
    }

    console.info('[admin] treatment_type updated', {
      id,
      by: auth.email ?? auth.userId,
      auditReason: data.auditReason,
    });

    return NextResponse.json({ treatmentType: r.rows[0] });
  } catch (error) {
    console.error('Error updating treatment type:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezeléstípus módosításakor' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/treatment-types/:id — delete. Tiltás ha care_pathways hivatkozik.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const id = params.id;
    const pool = getDbPool();

    const exists = await pool.query(
      `SELECT 1 FROM treatment_types WHERE id = $1`,
      [id]
    );
    if (exists.rows.length === 0) {
      return NextResponse.json({ error: 'Kezeléstípus nem található' }, { status: 404 });
    }

    const refs = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM care_pathways WHERE treatment_type_id = $1`,
      [id]
    );
    if ((refs.rows[0]?.cnt ?? 0) > 0) {
      return NextResponse.json(
        {
          error: 'Nem törölhető: legalább egy kezelési út hivatkozik erre a típusra.',
          code: 'TREATMENT_TYPE_IN_USE',
        },
        { status: 409 }
      );
    }

    await pool.query(`DELETE FROM treatment_types WHERE id = $1`, [id]);

    const auditReason = request.nextUrl.searchParams.get('auditReason');
    console.info('[admin] treatment_type deleted', {
      id,
      by: auth.email ?? auth.userId,
      auditReason: auditReason ?? 'nincs',
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting treatment type:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezeléstípus törlésekor' },
      { status: 500 }
    );
  }
}
