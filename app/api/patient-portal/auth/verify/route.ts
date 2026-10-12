import { NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/patient-portal-auth';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import {
  createPatientPortalSession,
  isCrossOriginPortalPost,
  portalRedirect,
  setPatientPortalSessionCookie,
} from '@/lib/patient-portal-session';
import { getPatientEmailInfo, sendPatientLoginNotification } from '@/lib/patient-portal-email';
import { sendPatientLoginNotificationToAdmins } from '@/lib/email';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Email scanners and previews may follow GET links. Only a submitted form logs in.
export const GET = apiHandler(async (req) => {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return portalRedirect(req, '/patient-portal?error=missing_token');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return portalRedirect(req, '/patient-portal?error=invalid_token');
  }
  return portalRedirect(req, `/patient-portal/sign-in?token=${token}`);
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

    const verification = await verifyPortalToken(token, 'magic_link');
    if (!verification) return portalRedirect(req, '/patient-portal?error=invalid_token');

    if (verification.isUsed) {
      // Reloading a link in the browser that already logged in is harmless.
      const patientId = await verifyPatientPortalSession(req);
      return portalRedirect(req, patientId === verification.patientId
        ? '/patient-portal/dashboard'
        : '/patient-portal?error=token_used');
    }

    const sessionToken = await createPatientPortalSession(verification.patientId);
    const response = portalRedirect(req, '/patient-portal/dashboard');
    setPatientPortalSessionCookie(response, req, sessionToken);

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    // SMTP delays must not hold up delivery of the browser's session cookie.
    void sendLoginNotifications(verification.patientId, ipAddress);
    return response;
  } catch (error: unknown) {
    logger.error('Error verifying patient portal login:', error);
    const databaseError = (error as { code?: string })?.code === '42P01'
      || (error instanceof Error && error.message.includes('table missing'));
    return portalRedirect(req, `/patient-portal?error=${databaseError ? 'database_error' : 'verification_failed'}`);
  }
});

async function sendLoginNotifications(patientId: string, ipAddress: string | null): Promise<void> {
  try {
    const patientInfo = await getPatientEmailInfo(patientId);
    if (!patientInfo?.email) return;

    const loginTime = new Date();
    await sendPatientLoginNotification(
      patientInfo.email, patientInfo.name, loginTime, ipAddress, patientId,
    );

    const pool = getDbPool();
    const adminResult = await pool.query(`SELECT email FROM users WHERE role = 'admin' AND active = true`);
    const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
    if (adminEmails.length === 0) return;

    const patientResult = await pool.query('SELECT taj FROM patients WHERE id = $1', [patientId]);
    await sendPatientLoginNotificationToAdmins(
      adminEmails, patientInfo.email, patientInfo.name,
      patientResult.rows[0]?.taj || null, loginTime, ipAddress,
    );
  } catch (error) {
    logger.error('Error sending patient portal login notifications:', error);
  }
}
