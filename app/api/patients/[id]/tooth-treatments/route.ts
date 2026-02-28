import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients/:id/tooth-treatments — list tooth treatments for patient
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();
    const patientId = params.id;

    const tableExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tooth_treatments'`
    );
    if (tableExists.rows.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const result = await pool.query(
      `SELECT tt.id, tt.patient_id as "patientId", tt.tooth_number as "toothNumber",
              tt.treatment_code as "treatmentCode", tt.status, tt.episode_id as "episodeId",
              tt.notes, tt.created_by as "createdBy", tt.created_at as "createdAt",
              tt.completed_at as "completedAt",
              tc.label_hu as "labelHu"
       FROM tooth_treatments tt
       JOIN tooth_treatment_catalog tc ON tt.treatment_code = tc.code
       WHERE tt.patient_id = $1
       ORDER BY tt.tooth_number, tc.sort_order, tt.created_at`,
      [patientId]
    );

    return NextResponse.json({ items: result.rows });
  } catch (error) {
    logger.error('Error fetching tooth treatments:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fog-kezelési igények lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/patients/:id/tooth-treatments — add tooth treatment need
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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
    const patientId = params.id;
    const body = await request.json();

    const toothNumber = typeof body.toothNumber === 'number' ? body.toothNumber : parseInt(body.toothNumber, 10);
    const treatmentCode = (body.treatmentCode as string)?.trim();
    const notes = (body.notes as string)?.trim() || null;

    if (!toothNumber || toothNumber < 11 || toothNumber > 48) {
      return NextResponse.json({ error: 'Érvénytelen fogszám (11-48)' }, { status: 400 });
    }
    if (!treatmentCode) {
      return NextResponse.json({ error: 'treatment_code kötelező' }, { status: 400 });
    }

    const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
    if (patientCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
    }

    try {
      const result = await pool.query(
        `INSERT INTO tooth_treatments (patient_id, tooth_number, treatment_code, notes, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, patient_id as "patientId", tooth_number as "toothNumber",
                   treatment_code as "treatmentCode", status, episode_id as "episodeId",
                   notes, created_by as "createdBy", created_at as "createdAt",
                   completed_at as "completedAt"`,
        [patientId, toothNumber, treatmentCode, notes, auth.userId || null]
      );

      const row = result.rows[0];
      const catalogResult = await pool.query(
        'SELECT label_hu as "labelHu" FROM tooth_treatment_catalog WHERE code = $1',
        [treatmentCode]
      );
      row.labelHu = catalogResult.rows[0]?.labelHu ?? treatmentCode;

      return NextResponse.json({ item: row }, { status: 201 });
    } catch (err: unknown) {
      const msg = String(err ?? '');
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return NextResponse.json(
          { error: 'Ez a kezelési igény már létezik ennél a fognál (aktív állapotban).' },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (error) {
    logger.error('Error creating tooth treatment:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fog-kezelési igény létrehozásakor' },
      { status: 500 }
    );
  }
}
