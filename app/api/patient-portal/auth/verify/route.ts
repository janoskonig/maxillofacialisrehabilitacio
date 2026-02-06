import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/patient-portal-auth';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { getPatientEmailInfo, sendPatientLoginNotification } from '@/lib/patient-portal-email';
import { sendPatientLoginNotificationToAdmins } from '@/lib/email';
import { getDbPool } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const PORTAL_SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Get base URL for redirects
 * Priority: 1. NEXT_PUBLIC_BASE_URL env var, 2. Request origin (dev), 3. Production URL
 */
function getBaseUrl(request: NextRequest): string {
  const envBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  
  // If environment variable is set, use it (works for both local and production)
  if (envBaseUrl) {
    return envBaseUrl;
  }
  
  // In development, use request origin to support local testing
  if (process.env.NODE_ENV === 'development') {
    const origin = request.headers.get('origin') || request.nextUrl.origin;
    return origin;
  }
  
  // Production fallback
  return 'https://rehabilitacios-protetika.hu';
}

/**
 * Verify magic link token and create portal session
 * GET /api/patient-portal/auth/verify?token=xxx
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  console.log('[verify] ===== VERIFY ROUTE CALLED =====');
  console.log('[verify] Request URL:', request.url);
  console.log('[verify] Request method:', request.method);
  
  try {
    const baseUrl = getBaseUrl(request);
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    console.log('[verify] Starting verification, baseUrl:', baseUrl, 'token length:', token?.length, 'token first 20 chars:', token?.substring(0, 20));
    console.log('[verify] Full token:', token);

    if (!token) {
      console.log('[verify] No token provided');
      return NextResponse.redirect(
        new URL('/patient-portal?error=missing_token', baseUrl)
      );
    }

    // Verify token
    console.log('[verify] Calling verifyPortalToken...');
    const verification = await verifyPortalToken(token, 'magic_link');
    console.log('[verify] Verification result:', verification ? {
      success: true,
      patientId: verification.patientId,
      isUsed: verification.isUsed,
    } : 'failed');

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

    // Session successfully created - now send login notifications
    // Only send emails if login was successful (session created)
    try {
      const patientInfo = await getPatientEmailInfo(verification.patientId);
      if (patientInfo && patientInfo.email) {
        // Send notification to patient
        await sendPatientLoginNotification(
          patientInfo.email,
          patientInfo.name,
          new Date(),
          ipAddress
        );
        console.log('Login notification email sent to:', patientInfo.email);

        // Send notification to admins (only after successful login)
        try {
          const pool = getDbPool();
          const adminResult = await pool.query(
            `SELECT email FROM users WHERE role = 'admin' AND active = true`
          );
          const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
          
          if (adminEmails.length > 0) {
            // Get patient TAJ for admin notification
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
            console.log('Login notification email sent to admins');
          }
        } catch (adminEmailError) {
          // Don't fail the login if admin email sending fails
          console.error('Error sending login notification email to admins:', adminEmailError);
        }
      } else {
        console.warn('Could not send login notification: patient email not found');
      }
    } catch (emailError) {
      // Don't fail the login if email sending fails
      console.error('Error sending login notification email:', emailError);
    }

    console.log('Session created, redirecting to dashboard');
    // Redirect to portal dashboard
    return NextResponse.redirect(new URL('/patient-portal/dashboard', baseUrl));
  } catch (error: any) {
    console.error('[verify] ===== ERROR IN VERIFY ROUTE =====');
    console.error('[verify] Error type:', error?.constructor?.name);
    console.error('[verify] Error message:', error?.message);
    console.error('[verify] Error code:', error?.code);
    console.error('[verify] Error stack:', error?.stack);
    console.error('[verify] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    const baseUrl = getBaseUrl(request);
    
    // Check if it's a database table missing error
    if (error?.message?.includes('table does not exist') || error?.code === '42P01') {
      console.error('[verify] Database table missing error');
      return NextResponse.redirect(
        new URL('/patient-portal?error=database_error', baseUrl)
      );
    }
    
    console.error('[verify] Redirecting to error page: verification_failed');
    return NextResponse.redirect(
      new URL('/patient-portal?error=verification_failed', baseUrl)
    );
  }
}
