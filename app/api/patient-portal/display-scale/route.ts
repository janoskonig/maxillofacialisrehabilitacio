import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import { isPortalDisplayScale } from '@/lib/portal-display-scale';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patient-portal/display-scale — a beteg kényelmi-mód fokozata.
 * PUT — fokozat mentése { scale: 'normal' | 'nagy' | 'extra' }.
 */
export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT portal_display_scale AS scale FROM patients WHERE id = $1`,
    [patientId]
  );
  const scale = result.rows[0]?.scale;
  return NextResponse.json({ scale: isPortalDisplayScale(scale) ? scale : 'normal' });
});

export const PUT = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const scale = body?.scale;
  if (!isPortalDisplayScale(scale)) {
    return NextResponse.json({ error: 'Érvénytelen fokozat' }, { status: 400 });
  }

  const pool = getDbPool();
  // set_config(...): megjelenítési preferencia, nem klinikai adat → ne bumpolja
  // az optimista zár updated_at tokenjét (lásd database/migrations/062).
  await pool.query(
    `UPDATE patients SET portal_display_scale = $2
      WHERE id = $1 AND set_config('app.skip_updated_at','on',true) IS NOT NULL`,
    [patientId, scale]
  );
  return NextResponse.json({ success: true, scale });
});
