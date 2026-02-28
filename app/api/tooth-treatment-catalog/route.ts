import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tooth-treatment-catalog — list active tooth treatment types
 * Any authenticated user can read (needed for PatientForm dropdown).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();

    const tableExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tooth_treatment_catalog'`
    );
    if (tableExists.rows.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const onlyActive = request.nextUrl.searchParams.get('all') !== 'true';
    const whereClause = onlyActive ? 'WHERE is_active = true' : '';

    const result = await pool.query(
      `SELECT code, label_hu as "labelHu", label_en as "labelEn",
              default_care_pathway_id as "defaultCarePathwayId",
              sort_order as "sortOrder", is_active as "isActive"
       FROM tooth_treatment_catalog
       ${whereClause}
       ORDER BY sort_order, code`
    );

    return NextResponse.json({ items: result.rows });
  } catch (error) {
    logger.error('Error fetching tooth treatment catalog:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fog-kezelési katalógus lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tooth-treatment-catalog — create new tooth treatment type
 * Admin / fogpótlástanász only.
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
    const code = (body.code as string)?.trim()?.toLowerCase()?.replace(/\s+/g, '_');
    const labelHu = (body.labelHu as string)?.trim();
    const labelEn = (body.labelEn as string)?.trim() || null;
    const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;
    const defaultCarePathwayId = (body.defaultCarePathwayId as string)?.trim() || null;

    if (!code || !/^[a-z0-9_]+$/.test(code)) {
      return NextResponse.json({ error: 'Érvénytelen code (csak a-z, 0-9, _ megengedett)' }, { status: 400 });
    }
    if (!labelHu) {
      return NextResponse.json({ error: 'label_hu kötelező' }, { status: 400 });
    }

    const pool = getDbPool();

    try {
      const result = await pool.query(
        `INSERT INTO tooth_treatment_catalog (code, label_hu, label_en, default_care_pathway_id, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING code, label_hu as "labelHu", label_en as "labelEn",
                   default_care_pathway_id as "defaultCarePathwayId",
                   sort_order as "sortOrder", is_active as "isActive"`,
        [code, labelHu, labelEn, defaultCarePathwayId, sortOrder]
      );

      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    } catch (err: unknown) {
      const msg = String(err ?? '');
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return NextResponse.json({ error: 'Ez a code már létezik.' }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    logger.error('Error creating tooth treatment catalog item:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fog-kezelési típus létrehozásakor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/tooth-treatment-catalog — update existing item (by code in body)
 * Admin / fogpótlástanász only.
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const body = await request.json();
    const code = (body.code as string)?.trim();
    if (!code) {
      return NextResponse.json({ error: 'code kötelező' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.labelHu !== undefined) {
      updates.push(`label_hu = $${idx++}`);
      values.push((body.labelHu as string).trim());
    }
    if (body.labelEn !== undefined) {
      updates.push(`label_en = $${idx++}`);
      values.push((body.labelEn as string)?.trim() || null);
    }
    if (body.sortOrder !== undefined) {
      updates.push(`sort_order = $${idx++}`);
      values.push(body.sortOrder);
    }
    if (body.isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(body.isActive === true);
    }
    if (body.defaultCarePathwayId !== undefined) {
      updates.push(`default_care_pathway_id = $${idx++}`);
      values.push(body.defaultCarePathwayId || null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nincs módosítandó mező' }, { status: 400 });
    }

    values.push(code);
    const pool = getDbPool();
    const result = await pool.query(
      `UPDATE tooth_treatment_catalog SET ${updates.join(', ')}
       WHERE code = $${idx}
       RETURNING code, label_hu as "labelHu", label_en as "labelEn",
                 default_care_pathway_id as "defaultCarePathwayId",
                 sort_order as "sortOrder", is_active as "isActive"`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Nem található' }, { status: 404 });
    }

    return NextResponse.json({ item: result.rows[0] });
  } catch (error) {
    logger.error('Error updating tooth treatment catalog item:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fog-kezelési típus frissítésekor' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tooth-treatment-catalog — soft-delete (deactivate) by code
 * Admin only.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Csak admin törölhet' }, { status: 403 });
    }

    const code = request.nextUrl.searchParams.get('code');
    if (!code) {
      return NextResponse.json({ error: 'code query param kötelező' }, { status: 400 });
    }

    const pool = getDbPool();
    const result = await pool.query(
      `UPDATE tooth_treatment_catalog SET is_active = false WHERE code = $1 RETURNING code`,
      [code]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Nem található' }, { status: 404 });
    }

    return NextResponse.json({ deleted: code });
  } catch (error) {
    logger.error('Error deleting tooth treatment catalog item:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fog-kezelési típus törlésekor' },
      { status: 500 }
    );
  }
}
