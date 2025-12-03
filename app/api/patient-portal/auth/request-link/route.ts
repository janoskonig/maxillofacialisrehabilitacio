import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createMagicLinkToken } from '@/lib/patient-portal-auth';
import { sendPatientMagicLink, getPatientEmailInfo } from '@/lib/patient-portal-email';

/**
 * Request magic link for existing patient login
 * POST /api/patient-portal/auth/request-link
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, taj } = body;

    if (!email || !taj) {
      return NextResponse.json(
        { error: 'Email cím és TAJ szám megadása kötelező' },
        { status: 400 }
      );
    }

    // Clean TAJ (remove dashes and spaces)
    const cleanTaj = taj.replace(/[-\s]/g, '');

    // Validate TAJ format (9 digits)
    if (!/^\d{9}$/.test(cleanTaj)) {
      return NextResponse.json(
        { error: 'Érvénytelen TAJ szám formátum' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: 'Érvénytelen email cím formátum' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Find patient by email and TAJ
    const patientResult = await pool.query(
      `SELECT id, email, nev, taj 
       FROM patients 
       WHERE LOWER(email) = LOWER($1) AND REPLACE(REPLACE(taj, '-', ''), ' ', '') = $2`,
      [email.trim(), cleanTaj]
    );

    if (patientResult.rows.length === 0) {
      // Don't reveal if email or TAJ is wrong (security)
      return NextResponse.json(
        { 
          error: 'Nem található beteg ezzel az email címmel és TAJ számmal. ' +
                 'Ha még nem regisztrált, kérjük használja a regisztrációs oldalt.'
        },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];

    // Check if patient email is verified (for new registrations)
    // For now, we'll allow all existing patients to request magic links
    // In the future, we can add an email_verified field

    // Get IP address
    const ipHeader = request.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;

    // Create magic link token
    const token = await createMagicLinkToken(patient.id, ipAddress);

    // Get patient info for email
    const patientInfo = await getPatientEmailInfo(patient.id);
    if (!patientInfo) {
      return NextResponse.json(
        { error: 'Hiba történt az email küldésekor' },
        { status: 500 }
      );
    }

    // Send magic link email
    await sendPatientMagicLink(patientInfo.email, patientInfo.name, token);

    return NextResponse.json({
      success: true,
      message: 'Bejelentkezési link elküldve az email címére',
    });
  } catch (error) {
    console.error('Error requesting magic link:', error);
    return NextResponse.json(
      { error: 'Hiba történt a bejelentkezési link kérésekor' },
      { status: 500 }
    );
  }
}





