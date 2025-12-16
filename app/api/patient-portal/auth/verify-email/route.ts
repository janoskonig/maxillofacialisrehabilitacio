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
 * Verify email verification token and activate patient account
 * GET /api/patient-portal/auth/verify-email?token=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const baseUrl = getBaseUrl(request);
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    console.log('[verify-email] Starting verification, baseUrl:', baseUrl, 'token length:', token?.length);

    if (!token) {
      console.log('[verify-email] No token provided');
      return NextResponse.redirect(
        new URL('/patient-portal?error=missing_token', baseUrl)
      );
    }

    // Verify email verification token
    console.log('[verify-email] Verifying token...');
    const verification = await verifyPortalToken(token, 'email_verification');
    console.log('[verify-email] Verification result:', verification ? 'success' : 'failed', verification);

    if (!verification) {
      console.log('[verify-email] Token verification failed - token not found, expired, or invalid');
      return NextResponse.redirect(
        new URL('/patient-portal?error=invalid_token', baseUrl)
      );
    }

    if (verification.isUsed) {
      console.log('[verify-email] Token already used');
      return NextResponse.redirect(
        new URL('/patient-portal?error=token_used', baseUrl)
      );
    }

    console.log('[verify-email] Token verified successfully, patientId:', verification.patientId);

    // Mark patient as email verified (we can add a field for this later)
    // For now, we'll just create a magic link token and log them in
    const pool = getDbPool();
    
    // Check if patient exists
    console.log('[verify-email] Checking if patient exists:', verification.patientId);
    const patientResult = await pool.query(
      'SELECT id FROM patients WHERE id = $1',
      [verification.patientId]
    );

    if (patientResult.rows.length === 0) {
      console.log('[verify-email] Patient not found:', verification.patientId);
      return NextResponse.redirect(
        new URL('/patient-portal?error=patient_not_found', baseUrl)
      );
    }

    console.log('[verify-email] Patient found, creating session...');

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
    // Always use secure cookies in production (HTTPS), check if baseUrl is HTTPS
    const isSecure = baseUrl.startsWith('https://');
    cookieStore.set('patient_portal_session', sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      path: '/',
    });
    console.log('[verify-email] Cookie set with secure:', isSecure, 'baseUrl:', baseUrl);

    // Redirect to portal dashboard with success message
    return NextResponse.redirect(
      new URL('/patient-portal/dashboard?verified=true', baseUrl)
    );
  } catch (error: any) {
    console.error('[verify-email] Error verifying email:', error);
    console.error('[verify-email] Error details:', {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
    });
    const baseUrl = getBaseUrl(request);
    
    // Check if it's a database table missing error
    if (error?.message?.includes('table does not exist') || error?.code === '42P01') {
      console.error('[verify-email] Database table missing');
      return NextResponse.redirect(
        new URL('/patient-portal?error=database_error', baseUrl)
      );
    }
    
    return NextResponse.redirect(
      new URL('/patient-portal?error=verification_failed', baseUrl)
    );
  }
}
