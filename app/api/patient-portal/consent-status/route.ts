import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import { getPatientConsentObligations } from '@/lib/consent-obligations';
import { requiresGuardian } from '@/lib/legal/legal-capacity';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const obligations = await getPatientConsentObligations(patientId);
  if (!obligations) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const r = await getDbPool().query(
    `SELECT szuletesi_datum, torvenyes_kepviselo_nev FROM patients WHERE id = $1`,
    [patientId]
  );
  const row = r.rows[0];
  const isMinor = row ? requiresGuardian(row.szuletesi_datum) : false;

  return NextResponse.json({
    ...obligations,
    isMinor,
    guardianName: (row?.torvenyes_kepviselo_nev as string) ?? null,
  });
});
