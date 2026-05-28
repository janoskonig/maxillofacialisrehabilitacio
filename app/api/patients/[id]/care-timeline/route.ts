import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { buildPatientCareTimeline } from '@/lib/patient-care-timeline';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients/[id]/care-timeline
 * Egységes páciens timeline: stádium, konzílium, feladatok, milestone-ok, munkafázisok.
 */
export const GET = roleHandler(
  ['admin', 'beutalo_orvos', 'fogpótlástanász'],
  async (_req, { params }) => {
    const patientId = params.id;
    const pool = getDbPool();

    const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
    if (patientCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
    }

    const timeline = await buildPatientCareTimeline(patientId);
    return NextResponse.json(timeline);
  },
);
