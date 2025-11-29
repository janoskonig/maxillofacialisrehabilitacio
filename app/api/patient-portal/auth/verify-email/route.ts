import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken, createMagicLinkToken } from '@/lib/patient-portal-auth';
import { getDbPool } from '@/lib/db';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const PORTAL_SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Verify email verification token and activate patient account
 * GET /api/patient-portal/auth/verify-email?token=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.redirect(
        new URL('/patient-portal/register?error=missing_token', request.url)
      );
    }

    // Verify email verification token
    const verification = await verifyPortalToken(token, 'email_verification');

    if (!verification) {
      return NextResponse.redirect(
        new URL('/patient-portal/register?error=invalid_token', request.url)
      );
    }

    // Mark patient as email verified (we can add a field for this later)
    // For now, we'll just create a magic link token and log them in
    const pool = getDbPool();
    
    // Check if patient exists
    const patientResult = await pool.query(
      'SELECT id FROM patients WHERE id = $1',
      [verification.patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.redirect(
        new URL('/patient-portal/register?error=patient_not_found', request.url)
      );
    }

    // Create magic link token for immediate login
    const ipHeader = request.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;
    const magicLinkToken = await createMagicLinkToken(verification.patientId, ipAddress);

    // Create portal session JWT
    const sessionToken = await new SignJWT({
      patientId: verification.patientId,
      type: 'patient_portal',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Date.now() + PORTAL_SESSION_EXPIRES_IN)
      .sign(JWT_SECRET);

    // Set HTTP-only cookie
    const cookieStore = await cookies();
    cookieStore.set('patient_portal_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      path: '/',
    });

    // Redirect to portal dashboard with success message
    return NextResponse.redirect(
      new URL('/patient-portal/dashboard?verified=true', request.url)
    );
  } catch (error) {
    console.error('Error verifying email:', error);
    return NextResponse.redirect(
      new URL('/patient-portal/register?error=verification_failed', request.url)
    );
  }
}


