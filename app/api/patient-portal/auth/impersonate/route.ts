import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { getDbPool } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { roleHandler } from '@/lib/api/route-handler';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const PORTAL_SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days

function getBaseUrl(request: { headers: { get(name: string): string | null } }): string {
  const envBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  if (envBaseUrl) {
    return envBaseUrl;
  }

  if (process.env.NODE_ENV === 'development') {
    const origin = request.headers.get('origin') || '';
    return origin || 'http://localhost:3000';
  }

  return 'https://rehabilitacios-protetika.hu';
}

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

  const baseUrl = getBaseUrl(req);
  const sessionToken = await new SignJWT({
    patientId: patient.id,
    type: 'patient_portal',
    impersonatedBy: auth.userId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Date.now() + PORTAL_SESSION_EXPIRES_IN)
    .sign(JWT_SECRET);

  const cookieStore = await cookies();
  const isSecure = baseUrl.startsWith('https://');
  cookieStore.set('patient_portal_session', sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });

  await logActivity(
    req,
    auth.email,
    'impersonate_patient',
    `Betegimpersonálás: ${patient.nev} (${patient.taj || 'Nincs TAJ'})`
  );

  const redirectUrl = new URL('/patient-portal/dashboard', baseUrl);
  redirectUrl.searchParams.set('impersonated', 'true');

  return NextResponse.json({
    success: true,
    redirectUrl: redirectUrl.toString(),
  });
});
