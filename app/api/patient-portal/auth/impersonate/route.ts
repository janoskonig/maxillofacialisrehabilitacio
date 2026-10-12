import { NextResponse } from 'next/server';
import { createPatientPortalSession, getPortalRequestBaseUrl, setPatientPortalSessionCookie } from '@/lib/patient-portal-session';
import { getDbPool } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = roleHandler(['admin'], async (req, { correlationId, auth }) => {
  const body = await req.json();
  const { patientId } = body;

  if (!patientId) {
    return NextResponse.json(
      { error: 'Beteg ID megadása kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  const patientResult = await pool.query(
    'SELECT id, nev, email, taj FROM patients WHERE id = $1',
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  const patient = patientResult.rows[0];

  const sessionToken = await createPatientPortalSession(patient.id, auth.userId);

  await logActivity(
    req,
    auth.email,
    'impersonate_patient',
    `Betegimpersonálás: ${patient.nev} (${patient.taj || 'Nincs TAJ'})`
  );

  const redirectUrl = new URL('/patient-portal/dashboard', getPortalRequestBaseUrl(req));
  redirectUrl.searchParams.set('impersonated', 'true');

  const response = NextResponse.json({
    success: true,
    redirectUrl: redirectUrl.toString(),
  });
  setPatientPortalSessionCookie(response, req, sessionToken);
  return response;
});
