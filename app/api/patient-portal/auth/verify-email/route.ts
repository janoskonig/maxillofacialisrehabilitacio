import { NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/patient-portal-auth';
import { getDbPool } from '@/lib/db';
import {
  createPatientPortalSession,
  isCrossOriginPortalPost,
  portalRedirect,
  setPatientPortalSessionCookie,
} from '@/lib/patient-portal-session';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return portalRedirect(req, '/patient-portal?error=missing_token');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return portalRedirect(req, '/patient-portal?error=invalid_token');
  }
  return portalRedirect(req, `/patient-portal/sign-in?token=${token}&mode=email`);
});

export const POST = apiHandler(async (req) => {
  if (isCrossOriginPortalPost(req)) {
    return NextResponse.json({ error: 'Érvénytelen bejelentkezési kérés' }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const token = form.get('token');
    if (!token) return portalRedirect(req, '/patient-portal?error=missing_token');
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return portalRedirect(req, '/patient-portal?error=invalid_token');
    }

    const verification = await verifyPortalToken(token, 'email_verification');
    if (!verification) return portalRedirect(req, '/patient-portal?error=invalid_token');

    const patientResult = await getDbPool().query('SELECT id FROM patients WHERE id = $1', [verification.patientId]);
    if (patientResult.rows.length === 0) {
      return portalRedirect(req, '/patient-portal?error=patient_not_found');
    }

    const sessionToken = await createPatientPortalSession(verification.patientId);
    const response = portalRedirect(req, '/patient-portal/dashboard?verified=true');
    setPatientPortalSessionCookie(response, req, sessionToken);
    return response;
  } catch (error: unknown) {
    logger.error('Error verifying patient portal email:', error);
    const databaseError = (error as { code?: string })?.code === '42P01'
      || (error instanceof Error && error.message.includes('table missing'));
    return portalRedirect(req, `/patient-portal?error=${databaseError ? 'database_error' : 'verification_failed'}`);
  }
});
