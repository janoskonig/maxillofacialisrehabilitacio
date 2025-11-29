import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/patient-portal-auth';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const PORTAL_SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Verify magic link token and create portal session
 * GET /api/patient-portal/auth/verify?token=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.redirect(
        new URL('/patient-portal?error=missing_token', request.url)
      );
    }

    // Verify token
    const verification = await verifyPortalToken(token, 'magic_link');

    if (!verification) {
      return NextResponse.redirect(
        new URL('/patient-portal?error=invalid_token', request.url)
      );
    }

    if (verification.isUsed) {
      return NextResponse.redirect(
        new URL('/patient-portal?error=token_used', request.url)
      );
    }

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

    // Redirect to portal dashboard
    return NextResponse.redirect(new URL('/patient-portal/dashboard', request.url));
  } catch (error) {
    console.error('Error verifying token:', error);
    return NextResponse.redirect(
      new URL('/patient-portal?error=verification_failed', request.url)
    );
  }
}


