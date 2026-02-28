import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/patient-portal-auth';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { getPatientEmailInfo, sendPatientLoginNotification } from '@/lib/patient-portal-email';
import { sendPatientLoginNotificationToAdmins } from '@/lib/email';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const PORTAL_SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days

function getBaseUrl(request: NextRequest): string {
  const envBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  if (envBaseUrl) {
    return envBaseUrl;
  }

  if (process.env.NODE_ENV === 'development') {
    const origin = request.headers.get('origin') || request.nextUrl.origin;
    return origin;
  }

  return 'https://rehabilitacios-protetika.hu';
}

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  logger.info('[verify] ===== VERIFY ROUTE CALLED =====');
  logger.info('[verify] Request URL:', req.url);
  logger.info('[verify] Request method:', req.method);

  try {
    const baseUrl = getBaseUrl(req);
    const searchParams = req.nextUrl.searchParams;
    const token = searchParams.get('token');

    logger.info('[verify] Starting verification, baseUrl:', baseUrl, 'token length:', token?.length, 'token first 20 chars:', token?.substring(0, 20));
    logger.info('[verify] Full token:', token);

    if (!token) {
      logger.info('[verify] No token provided');
      return NextResponse.redirect(
        new URL('/patient-portal?error=missing_token', baseUrl)
      );
    }

    logger.info('[verify] Calling verifyPortalToken...');
    const verification = await verifyPortalToken(token, 'magic_link');
    logger.info('[verify] Verification result:', verification ? {
      success: true,
      patientId: verification.patientId,
      isUsed: verification.isUsed,
    } : 'failed');

    if (!verification) {
      logger.info('Token verification failed - token not found, expired, or invalid');
      return NextResponse.redirect(
        new URL('/patient-portal?error=invalid_token', baseUrl)
      );
    }

    if (verification.isUsed) {
      logger.info('Token already used');
      return NextResponse.redirect(
        new URL('/patient-portal?error=token_used', baseUrl)
      );
    }

    logger.info('Token verified successfully, creating session for patient:', verification.patientId);

    const ipHeader = req.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;

    const sessionToken = await new SignJWT({
      patientId: verification.patientId,
      type: 'patient_portal',
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
    logger.info('Cookie set with secure:', isSecure, 'baseUrl:', baseUrl);

    try {
      const patientInfo = await getPatientEmailInfo(verification.patientId);
      if (patientInfo && patientInfo.email) {
        await sendPatientLoginNotification(
          patientInfo.email,
          patientInfo.name,
          new Date(),
          ipAddress
        );
        logger.info('Login notification email sent to:', patientInfo.email);

        try {
          const pool = getDbPool();
          const adminResult = await pool.query(
            `SELECT email FROM users WHERE role = 'admin' AND active = true`
          );
          const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);

          if (adminEmails.length > 0) {
            const patientResult = await pool.query(
              'SELECT taj FROM patients WHERE id = $1',
              [verification.patientId]
            );
            const patientTaj = patientResult.rows.length > 0 ? patientResult.rows[0].taj : null;

            await sendPatientLoginNotificationToAdmins(
              adminEmails,
              patientInfo.email,
              patientInfo.name,
              patientTaj,
              new Date(),
              ipAddress
            );
            logger.info('Login notification email sent to admins');
          }
        } catch (adminEmailError) {
          logger.error('Error sending login notification email to admins:', adminEmailError);
        }
      } else {
        console.warn('Could not send login notification: patient email not found');
      }
    } catch (emailError) {
      logger.error('Error sending login notification email:', emailError);
    }

    logger.info('Session created, redirecting to dashboard');
    return NextResponse.redirect(new URL('/patient-portal/dashboard', baseUrl));
  } catch (error: any) {
    logger.error('[verify] ===== ERROR IN VERIFY ROUTE =====');
    logger.error('[verify] Error type:', error?.constructor?.name);
    logger.error('[verify] Error message:', error?.message);
    logger.error('[verify] Error code:', error?.code);
    logger.error('[verify] Error stack:', error?.stack);
    logger.error('[verify] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));

    const baseUrl = getBaseUrl(req);

    if (error?.message?.includes('table does not exist') || error?.code === '42P01') {
      logger.error('[verify] Database table missing error');
      return NextResponse.redirect(
        new URL('/patient-portal?error=database_error', baseUrl)
      );
    }

    logger.error('[verify] Redirecting to error page: verification_failed');
    return NextResponse.redirect(
      new URL('/patient-portal?error=verification_failed', baseUrl)
    );
  }
});
