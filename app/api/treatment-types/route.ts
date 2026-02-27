import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { treatmentTypeCreateSchema } from '@/lib/admin-process-schemas';

/**
 * POST /api/treatment-types — create treatment type (admin / fogpótlástanász)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const body = await request.json();
    const auditReason =
      body.auditReason ?? request.nextUrl.searchParams.get('auditReason');
    const parsed = treatmentTypeCreateSchema.safeParse({ ...body, auditReason });
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const data = parsed.data;

    const pool = getDbPool();
    try {
      await pool.query('BEGIN');
      const r = await pool.query(
        `INSERT INTO treatment_types (code, label_hu)
         VALUES ($1, $2)
         RETURNING id, code, label_hu as "labelHu"`,
        [data.code, data.labelHu]
      );
      const row = r.rows[0];
      // Auto-create empty pathway for new treatment type (steps_json = [])
      await pool.query(
        `INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
         VALUES ($1, NULL, $2, '[]'::jsonb, 1, 0)`,
        [row.labelHu, row.id]
      );
      await pool.query('COMMIT');
      console.info('[admin] treatment_type created', {
        id: row.id,
        code: row.code,
        by: auth.email ?? auth.userId,
        auditReason: data.auditReason,
      });

      return NextResponse.json({ treatmentType: row });
    } catch (err: unknown) {
      await pool.query('ROLLBACK').catch(() => {});
      const msg = String(err ?? '');
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return NextResponse.json(
          { error: 'A code már létezik.', code: 'CODE_EXISTS' },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (error) {
    console.error('Error creating treatment type:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezeléstípus létrehozásakor' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/treatment-types — lookup for care pathway treatment types (dropdown, reports)
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();

    const tableExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'treatment_types'`
    );
    if (tableExists.rows.length === 0) {
      return NextResponse.json({ treatmentTypes: [] });
    }

    const r = await pool.query(
      `SELECT id, code, label_hu as "labelHu" FROM treatment_types ORDER BY label_hu ASC`
    );

    return NextResponse.json({ treatmentTypes: r.rows });
  } catch (error) {
    console.error('Error fetching treatment types:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési típusok lekérdezésekor' },
      { status: 500 }
    );
  }
}
