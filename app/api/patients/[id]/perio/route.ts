import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { perioChartSchema } from '@/lib/perio';

export const dynamic = 'force-dynamic';

const ALLOWED = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/**
 * GET /api/patients/[id]/perio
 * A beteg aktuális parodontális chartja (vagy null, ha még nincs felvétel).
 */
export const GET = roleHandler([...ALLOWED], async (_req, { params }) => {
  const patientId = params.id;
  const pool = getDbPool();

  const res = await pool.query(
    `SELECT data, recorded_at AS "recordedAt", recorded_by AS "recordedBy", updated_at AS "updatedAt"
       FROM perio_charts WHERE patient_id = $1`,
    [patientId]
  );

  if (res.rows.length === 0) {
    return NextResponse.json({ chart: null });
  }

  const row = res.rows[0];
  return NextResponse.json({
    chart: row.data ?? { teeth: {} },
    recordedAt: row.recordedAt,
    recordedBy: row.recordedBy,
    updatedAt: row.updatedAt,
  });
});

/**
 * PUT /api/patients/[id]/perio
 * A beteg aktuális parodontális chartjának upsertje.
 */
export const PUT = roleHandler([...ALLOWED], async (req, { auth, params }) => {
  const patientId = params.id;

  const body = await req.json();
  const parsed = perioChartSchema.safeParse(body?.chart ?? body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Érvénytelen parodontális adat', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const res = await pool.query(
    `INSERT INTO perio_charts (patient_id, data, recorded_by, recorded_at, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW(), NOW())
     ON CONFLICT (patient_id) DO UPDATE
       SET data = EXCLUDED.data,
           recorded_by = EXCLUDED.recorded_by,
           updated_at = NOW()
     RETURNING data, recorded_at AS "recordedAt", recorded_by AS "recordedBy", updated_at AS "updatedAt"`,
    [patientId, JSON.stringify(parsed.data), auth.userId]
  );

  const row = res.rows[0];
  return NextResponse.json({
    chart: row.data,
    recordedAt: row.recordedAt,
    recordedBy: row.recordedBy,
    updatedAt: row.updatedAt,
  });
});
