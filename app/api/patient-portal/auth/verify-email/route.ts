import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken, createMagicLinkToken } from '@/lib/patient-portal-auth';
import { getDbPool } from '@/lib/db';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
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
  try {
    const baseUrl = getBaseUrl(req);
    const searchParams = req.nextUrl.searchParams;
    const token = searchParams.get('token');

    logger.info('[verify-email] Starting verification, baseUrl:', baseUrl, 'token length:', token?.length);

    if (!token) {
      logger.info('[verify-email] No token provided');
      return NextResponse.redirect(
        new URL('/patient-portal?error=missing_token', baseUrl)
      );
    }

    logger.info('[verify-email] Verifying token...');
    const verification = await verifyPortalToken(token, 'email_verification');
    logger.info('[verify-email] Verification result:', verification ? 'success' : 'failed', verification);

    if (!verification) {
      logger.info('[verify-email] Token verification failed - token not found, expired, or invalid');
      return NextResponse.redirect(
        new URL('/patient-portal?error=invalid_token', baseUrl)
      );
    }

    if (verification.isUsed) {
      logger.info('[verify-email] Token already used');
      return NextResponse.redirect(
        new URL('/patient-portal?error=token_used', baseUrl)
      );
    }

    logger.info('[verify-email] Token verified successfully, patientId:', verification.patientId);

    const pool = getDbPool();

    logger.info('[verify-email] Checking if patient exists:', verification.patientId);
    const patientResult = await pool.query(
      'SELECT id FROM patients WHERE id = $1',
      [verification.patientId]
    );

    if (patientResult.rows.length === 0) {
      logger.info('[verify-email] Patient not found:', verification.patientId);
      return NextResponse.redirect(
        new URL('/patient-portal?error=patient_not_found', baseUrl)
      );
    }

    logger.info('[verify-email] Patient found, creating session...');

    const ipHeader = req.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;
    const magicLinkToken = await createMagicLinkToken(verification.patientId, ipAddress);

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
    logger.info('[verify-email] Cookie set with secure:', isSecure, 'baseUrl:', baseUrl);

    return NextResponse.redirect(
      new URL('/patient-portal/dashboard?verified=true', baseUrl)
    );
  } catch (error: any) {
    logger.error('[verify-email] Error verifying email:', error);
    logger.error('[verify-email] Error details:', {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
    });
    const baseUrl = getBaseUrl(req);

    if (error?.message?.includes('table does not exist') || error?.code === '42P01') {
      logger.error('[verify-email] Database table missing');
      return NextResponse.redirect(
        new URL('/patient-portal?error=database_error', baseUrl)
      );
    }

    return NextResponse.redirect(
      new URL('/patient-portal?error=verification_failed', baseUrl)
    );
  }
});
