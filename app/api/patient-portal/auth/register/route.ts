import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createEmailVerificationToken, checkRegistrationRateLimit } from '@/lib/patient-portal-auth';
import { sendPatientVerificationEmail } from '@/lib/patient-portal-email';
import { sendPatientRegistrationNotificationToAdmins } from '@/lib/email';
import { Patient, patientSchema } from '@/lib/types';

/**
 * Register new patient for portal access
 * POST /api/patient-portal/auth/register
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      email, 
      taj, 
      nev,
      telefonszam,
      szuletesiDatum,
      nem,
      cim,
      varos,
      iranyitoszam,
      beutaloOrvos,
      beutaloIndokolas
    } = body;

    if (!email || !taj) {
      return NextResponse.json(
        { error: 'Email cím és TAJ szám megadása kötelező' },
        { status: 400 }
      );
    }

    if (!nev || !nev.trim()) {
      return NextResponse.json(
        { error: 'Név megadása kötelező' },
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

    // Check if patient already exists by TAJ only (one profile per TAJ)
    const existingByTajResult = await pool.query(
      `SELECT id, email, taj 
       FROM patients 
       WHERE REPLACE(REPLACE(taj, '-', ''), ' ', '') = $1`,
      [cleanTaj]
    );

    if (existingByTajResult.rows.length > 0) {
      return NextResponse.json(
        { error: 'Ez a TAJ szám már regisztrálva van. Használja a bejelentkezési oldalt.' },
        { status: 409 }
      );
    }

    // Format TAJ with dashes for storage
    const formattedTaj = `${cleanTaj.slice(0, 3)}-${cleanTaj.slice(3, 6)}-${cleanTaj.slice(6)}`;

    // Prepare patient data
    const insertResult = await pool.query(
      `INSERT INTO patients (
        email, 
        taj, 
        nev,
        telefonszam,
        szuletesi_datum,
        nem,
        cim,
        varos,
        iranyitoszam,
        beutalo_orvos,
        beutalo_indokolas,
        created_at, 
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, email, nev, taj`,
      [
        email.trim(),
        formattedTaj,
        nev.trim() || null,
        telefonszam?.trim() || null,
        szuletesiDatum?.trim() || null,
        nem || null,
        cim?.trim() || null,
        varos?.trim() || null,
        iranyitoszam?.trim() || null,
        beutaloOrvos?.trim() || null,
        beutaloIndokolas?.trim() || null,
      ]
    );

    const newPatient = insertResult.rows[0];

    // Get average waiting time statistics for first consultation
    // A várakozási időt az IDŐPONT LÉTREHOZÁSÁTÓL számoljuk (amikor a páciens megkapta az időpontot)
    let waitingTimeStats = null;
    try {
      const waitingTimeResult = await pool.query(`
        WITH first_appointments AS (
          SELECT DISTINCT ON (p.id)
            p.id as patient_id,
            ats.start_time as elso_idopont,
            a.created_at as idopont_letrehozas,
            EXTRACT(EPOCH FROM (ats.start_time - a.created_at)) / 86400 as varakozasi_ido_napokban
          FROM patients p
          JOIN appointments a ON p.id = a.patient_id
          JOIN available_time_slots ats ON a.time_slot_id = ats.id
          WHERE ats.start_time > a.created_at
            AND (a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio')
          ORDER BY p.id, ats.start_time ASC, a.created_at ASC
        )
        SELECT 
          ROUND(AVG(varakozasi_ido_napokban)::numeric, 1) as atlag_varakozasi_ido_napokban,
          ROUND(STDDEV_POP(varakozasi_ido_napokban)::numeric, 1) as szoras_varakozasi_ido_napokban
        FROM first_appointments
      `);
      
      if (waitingTimeResult.rows.length > 0 && waitingTimeResult.rows[0].atlag_varakozasi_ido_napokban) {
        waitingTimeStats = {
          atlagNapokban: parseFloat(waitingTimeResult.rows[0].atlag_varakozasi_ido_napokban),
          szorasNapokban: parseFloat(waitingTimeResult.rows[0].szoras_varakozasi_ido_napokban) || 0,
        };
      }
    } catch (error) {
      // Don't fail registration if waiting time query fails
      console.error('Error fetching waiting time stats:', error);
    }

    // Create email verification token
    const token = await createEmailVerificationToken(newPatient.id, ipAddress);

    // Always use production URL for email links (never localhost)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://rehabilitacios-protetika.hu';

    // Send verification email
    await sendPatientVerificationEmail(
      newPatient.email,
      newPatient.nev,
      token,
      baseUrl,
      waitingTimeStats
    );

    // Send admin notification
    try {
      const adminResult = await pool.query(
        `SELECT email FROM users WHERE role = 'admin' AND active = true`
      );
      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
      
      if (adminEmails.length > 0) {
        await sendPatientRegistrationNotificationToAdmins(
          adminEmails,
          newPatient.email,
          newPatient.nev,
          newPatient.taj,
          new Date()
        );
      }
    } catch (emailError) {
      console.error('Failed to send patient registration notification email to admins:', emailError);
      // Don't fail the registration if email fails
    }

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








