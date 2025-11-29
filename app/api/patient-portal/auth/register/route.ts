import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createEmailVerificationToken, checkRegistrationRateLimit } from '@/lib/patient-portal-auth';
import { sendPatientVerificationEmail } from '@/lib/patient-portal-email';
import { Patient, patientSchema } from '@/lib/types';

/**
 * Register new patient for portal access
 * POST /api/patient-portal/auth/register
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, taj, surgeonName, surgeonEmail } = body;

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
        { error: 'Érvénytelen TAJ szám formátum. A TAJ szám 9 számjegyből áll.' },
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

    // Get IP address for rate limiting
    const ipHeader = request.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;

    // Check rate limiting
    if (ipAddress && !(await checkRegistrationRateLimit(ipAddress))) {
      return NextResponse.json(
        { error: 'Túl sok regisztrációs kísérlet. Kérjük próbálja újra később.' },
        { status: 429 }
      );
    }

    const pool = getDbPool();

    // Check if patient already exists
    const existingPatientResult = await pool.query(
      `SELECT id, email, taj 
       FROM patients 
       WHERE LOWER(email) = LOWER($1) OR REPLACE(REPLACE(taj, '-', ''), ' ', '') = $2`,
      [email.trim(), cleanTaj]
    );

    if (existingPatientResult.rows.length > 0) {
      const existing = existingPatientResult.rows[0];
      if (existing.email && existing.email.toLowerCase() === email.trim().toLowerCase()) {
        return NextResponse.json(
          { error: 'Ez az email cím már regisztrálva van. Használja a bejelentkezési oldalt.' },
          { status: 409 }
        );
      }
      if (existing.taj && existing.taj.replace(/[-\s]/g, '') === cleanTaj) {
        return NextResponse.json(
          { error: 'Ez a TAJ szám már regisztrálva van.' },
          { status: 409 }
        );
      }
    }

    // Find surgeon if surgeon info provided
    let surgeonUserId: string | null = null;
    if (surgeonEmail || surgeonName) {
      let surgeonQuery = '';
      const surgeonParams: unknown[] = [];

      if (surgeonEmail) {
        surgeonQuery = 'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = $2';
        surgeonParams.push(surgeonEmail.trim(), 'sebészorvos');
      } else if (surgeonName) {
        surgeonQuery = 'SELECT id FROM users WHERE doktor_neve ILIKE $1 AND role = $2';
        surgeonParams.push(`%${surgeonName.trim()}%`, 'sebészorvos');
      }

      if (surgeonQuery) {
        const surgeonResult = await pool.query(surgeonQuery, surgeonParams);
        if (surgeonResult.rows.length > 0) {
          surgeonUserId = surgeonResult.rows[0].id;
        }
        // If surgeon not found, we'll still create the patient but without surgeon link
      }
    }

    // Format TAJ with dashes for storage
    const formattedTaj = `${cleanTaj.slice(0, 3)}-${cleanTaj.slice(3, 6)}-${cleanTaj.slice(6)}`;

    // Create patient record (minimal data)
    const patientData: Partial<Patient> = {
      email: email.trim(),
      taj: formattedTaj,
      // Other fields will be null/empty, can be filled later
    };

    // If surgeon found, set created_by
    const createdBy = surgeonUserId || null;

    const insertResult = await pool.query(
      `INSERT INTO patients (email, taj, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, email, nev, taj`,
      [patientData.email, patientData.taj, createdBy]
    );

    const newPatient = insertResult.rows[0];

    // Create email verification token
    const token = await createEmailVerificationToken(newPatient.id, ipAddress);

    // Send verification email
    await sendPatientVerificationEmail(
      newPatient.email,
      newPatient.nev,
      token
    );

    return NextResponse.json({
      success: true,
      message: 'Regisztráció sikeres! Kérjük, ellenőrizze email címét a megerősítő linkhez.',
      patientId: newPatient.id,
    });
  } catch (error) {
    console.error('Error registering patient:', error);
    return NextResponse.json(
      { error: 'Hiba történt a regisztráció során' },
      { status: 500 }
    );
  }
}


