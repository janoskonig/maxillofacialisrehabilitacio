import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/patient-portal-auth';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { getPatientEmailInfo, sendPatientLoginNotification } from '@/lib/patient-portal-email';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const PORTAL_SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Get base URL for redirects - always use production URL, never localhost
 */
function getBaseUrl(request: NextRequest): string {
  const envBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  
  // Always use production URL, ignore request origin (could be localhost due to reverse proxy)
  // Only use env var if it's not localhost
  if (envBaseUrl && !envBaseUrl.includes('localhost') && !envBaseUrl.includes('127.0.0.1')) {
    return envBaseUrl;
  }
  
  // Default to production URL
  return 'https://rehabilitacios-protetika.hu';
}

/**
 * Verify magic link token and create portal session
 * GET /api/patient-portal/auth/verify?token=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const baseUrl = getBaseUrl(request);
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    console.log('Verifying token, baseUrl:', baseUrl, 'token length:', token?.length);

    if (!token) {
      console.log('No token provided');
      return NextResponse.redirect(
        new URL('/patient-portal?error=missing_token', baseUrl)
      );
    }

    // Verify token
    const verification = await verifyPortalToken(token, 'magic_link');
    console.log('Verification result:', verification ? 'success' : 'failed');

    if (!verification) {
      console.log('Token verification failed - token not found, expired, or invalid');
      return NextResponse.redirect(
        new URL('/patient-portal?error=invalid_token', baseUrl)
      );
    }

    if (verification.isUsed) {
      console.log('Token already used');
      return NextResponse.redirect(
        new URL('/patient-portal?error=token_used', baseUrl)
      );
    }

    console.log('Token verified successfully, creating session for patient:', verification.patientId);

    // Get IP address from request for login notification
    const ipHeader = request.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;

    // Get patient email info and send login notification
    try {
      const patientInfo = await getPatientEmailInfo(verification.patientId);
      if (patientInfo && patientInfo.email) {
        await sendPatientLoginNotification(
          patientInfo.email,
          patientInfo.name,
          new Date(),
          ipAddress
        );
        console.log('Login notification email sent to:', patientInfo.email);
      } else {
        console.warn('Could not send login notification: patient email not found');
      }
    } catch (emailError) {
      // Don't fail the login if email sending fails
      console.error('Error sending login notification email:', emailError);
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
    // Always use secure cookies in production (HTTPS), check if baseUrl is HTTPS
    const isSecure = baseUrl.startsWith('https://');
    cookieStore.set('patient_portal_session', sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      path: '/',
    });
    console.log('Cookie set with secure:', isSecure, 'baseUrl:', baseUrl);

    console.log('Session created, redirecting to dashboard');
    // Redirect to portal dashboard
    return NextResponse.redirect(new URL('/patient-portal/dashboard', baseUrl));
  } catch (error: any) {
    console.error('Error verifying token:', error);
    const baseUrl = getBaseUrl(request);
    
    // Check if it's a database table missing error
    if (error?.message?.includes('table does not exist')) {
      return NextResponse.redirect(
        new URL('/patient-portal?error=database_error', baseUrl)
      );
    }
    
    return NextResponse.redirect(
      new URL('/patient-portal?error=verification_failed', baseUrl)
    );
  }
}
