import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { getDbPool } from '@/lib/db';
import { logActivity } from '@/lib/activity';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const PORTAL_SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Get base URL for redirects
 */
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

/**
 * Admin számára lehetővé teszi bármelyik beteg nevében való bejelentkezést
 * POST /api/patient-portal/auth/impersonate
 * Body: { patientId: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Ellenőrizzük, hogy az aktuális felhasználó admin-e
    const currentAuth = await verifyAuth(request);
    if (!currentAuth || currentAuth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak admin felhasználók használhatják ezt a funkciót' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { patientId } = body;

    if (!patientId) {
      return NextResponse.json(
        { error: 'Beteg ID megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    
    // Beteg keresése ID alapján
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

    // Get IP address from request for logging
    const ipHeader = request.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;

    // Create portal session JWT
    const baseUrl = getBaseUrl(request);
    const sessionToken = await new SignJWT({
      patientId: patient.id,
      type: 'patient_portal',
      impersonatedBy: currentAuth.userId, // Tároljuk, hogy ki impersonálta
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Date.now() + PORTAL_SESSION_EXPIRES_IN)
      .sign(JWT_SECRET);

    // Set HTTP-only cookie
    const cookieStore = await cookies();
    const isSecure = baseUrl.startsWith('https://');
    cookieStore.set('patient_portal_session', sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      path: '/',
    });

    // Activity log - az admin aktivitását naplózzuk
    await logActivity(
      request,
      currentAuth.email,
      'impersonate_patient',
      `Betegimpersonálás: ${patient.nev} (${patient.taj || 'Nincs TAJ'})`
    );

    // Return JSON with redirect URL (client will handle redirect)
    const redirectUrl = new URL('/patient-portal/dashboard', baseUrl);
    redirectUrl.searchParams.set('impersonated', 'true');
    
    return NextResponse.json({
      success: true,
      redirectUrl: redirectUrl.toString(),
    });
  } catch (error) {
    console.error('Patient impersonate error:', error);
    return NextResponse.json(
      { error: 'Hiba történt a bejelentkezéskor' },
      { status: 500 }
    );
  }
}
