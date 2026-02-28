import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createMagicLinkToken, checkRegistrationRateLimit } from '@/lib/patient-portal-auth';
import { sendPatientMagicLink, getPatientEmailInfo } from '@/lib/patient-portal-email';
import { logger } from '@/lib/logger';

/**
 * Request magic link - handles both existing and new patients
 * POST /api/patient-portal/auth/request-link
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      email, 
      taj,
      // Registration fields (optional, for new patients)
      nev,
      telefonszam,
      szuletesiDatum,
      nem,
      cim,
      varos,
      iranyitoszam,
      beutaloOrvos,
      beutaloIndokolas,
    } = body;

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

    // Get IP address for rate limiting
    const ipHeader = request.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;

    // Check rate limiting
    if (ipAddress && !(await checkRegistrationRateLimit(ipAddress))) {
      return NextResponse.json(
        { error: 'Túl sok kísérlet. Kérjük próbálja újra később.' },
        { status: 429 }
      );
    }

    const pool = getDbPool();

    // Find patient by TAJ only (one profile per TAJ; email may vary)
    const patientResult = await pool.query(
      `SELECT id, email, nev, taj 
       FROM patients 
       WHERE REPLACE(REPLACE(taj, '-', ''), ' ', '') = $1`,
      [cleanTaj]
    );

    let patientId: string;
    const isNewPatient = patientResult.rows.length === 0;

    if (isNewPatient) {
      // Patient doesn't exist - create new patient with provided data
      const formattedTaj = `${cleanTaj.slice(0, 3)}-${cleanTaj.slice(3, 6)}-${cleanTaj.slice(6)}`;
      
      // Build INSERT query with provided fields
      const insertFields: string[] = ['email', 'taj'];
      const insertValues: any[] = [email.trim(), formattedTaj];

      // Add optional fields if provided
      if (nev && nev.trim()) {
        insertFields.push('nev');
        insertValues.push(nev.trim());
      }
      if (telefonszam && telefonszam.trim()) {
        insertFields.push('telefonszam');
        insertValues.push(telefonszam.trim());
      }
      if (szuletesiDatum) {
        insertFields.push('szuletesi_datum');
        insertValues.push(szuletesiDatum);
      }
      if (nem && ['ferfi', 'no', 'nem_ismert'].includes(nem)) {
        insertFields.push('nem');
        insertValues.push(nem);
      }
      if (cim && cim.trim()) {
        insertFields.push('cim');
        insertValues.push(cim.trim());
      }
      if (varos && varos.trim()) {
        insertFields.push('varos');
        insertValues.push(varos.trim());
      }
      if (iranyitoszam && iranyitoszam.trim()) {
        insertFields.push('iranyitoszam');
        insertValues.push(iranyitoszam.trim());
      }
      if (beutaloOrvos && beutaloOrvos.trim()) {
        insertFields.push('beutalo_orvos');
        insertValues.push(beutaloOrvos.trim());
      }
      if (beutaloIndokolas && beutaloIndokolas.trim()) {
        insertFields.push('beutalo_indokolas');
        insertValues.push(beutaloIndokolas.trim());
      }

      // Add timestamps
      insertFields.push('created_at', 'updated_at');

      // Build placeholders - use $1, $2, etc. for values, CURRENT_TIMESTAMP for timestamps
      let paramIndex = 1;
      const placeholders = insertFields.map((field) => {
        if (field === 'created_at' || field === 'updated_at') {
          return 'CURRENT_TIMESTAMP';
        }
        const placeholder = `$${paramIndex}`;
        paramIndex++;
        return placeholder;
      }).join(', ');

      const insertQuery = `
        INSERT INTO patients (${insertFields.join(', ')})
        VALUES (${placeholders})
        RETURNING id, email, nev, taj
      `;

      const insertResult = await pool.query(insertQuery, insertValues);
      patientId = insertResult.rows[0].id;
    } else {
      // Patient exists (found by TAJ) - use existing profile
      patientId = patientResult.rows[0].id;
      const existingEmail = (patientResult.rows[0].email || '').trim();

      // Update patient data if provided (including email so magic link can be sent to the address they entered)
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (email.trim() && email.trim().toLowerCase() !== existingEmail.toLowerCase()) {
        updateFields.push(`email = $${paramIndex}`);
        updateValues.push(email.trim());
        paramIndex++;
      }
      if (nev && nev.trim()) {
        updateFields.push(`nev = $${paramIndex}`);
        updateValues.push(nev.trim());
        paramIndex++;
      }
      if (telefonszam && telefonszam.trim()) {
        updateFields.push(`telefonszam = $${paramIndex}`);
        updateValues.push(telefonszam.trim());
        paramIndex++;
      }
      if (szuletesiDatum) {
        updateFields.push(`szuletesi_datum = $${paramIndex}`);
        updateValues.push(szuletesiDatum);
        paramIndex++;
      }
      if (nem && ['ferfi', 'no', 'nem_ismert'].includes(nem)) {
        updateFields.push(`nem = $${paramIndex}`);
        updateValues.push(nem);
        paramIndex++;
      }
      if (cim && cim.trim()) {
        updateFields.push(`cim = $${paramIndex}`);
        updateValues.push(cim.trim());
        paramIndex++;
      }
      if (varos && varos.trim()) {
        updateFields.push(`varos = $${paramIndex}`);
        updateValues.push(varos.trim());
        paramIndex++;
      }
      if (iranyitoszam && iranyitoszam.trim()) {
        updateFields.push(`iranyitoszam = $${paramIndex}`);
        updateValues.push(iranyitoszam.trim());
        paramIndex++;
      }
      if (beutaloOrvos && beutaloOrvos.trim()) {
        updateFields.push(`beutalo_orvos = $${paramIndex}`);
        updateValues.push(beutaloOrvos.trim());
        paramIndex++;
      }
      if (beutaloIndokolas && beutaloIndokolas.trim()) {
        updateFields.push(`beutalo_indokolas = $${paramIndex}`);
        updateValues.push(beutaloIndokolas.trim());
        paramIndex++;
      }

      if (updateFields.length > 0) {
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        updateValues.push(patientId);
        
        await pool.query(
          `UPDATE patients 
           SET ${updateFields.join(', ')}
           WHERE id = $${paramIndex}`,
          updateValues
        );
      }
    }

    // Create magic link token
    const token = await createMagicLinkToken(patientId, ipAddress);

    // Get patient name for email (send to the email the user entered so they receive the link there)
    const patientInfo = await getPatientEmailInfo(patientId);
    if (!patientInfo) {
      return NextResponse.json(
        { error: 'Hiba történt az email küldésekor' },
        { status: 500 }
      );
    }

    // Get base URL: use env var if set, otherwise detect from request (dev) or use production
    let baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl) {
      if (process.env.NODE_ENV === 'development') {
        const origin = request.headers.get('origin') || request.nextUrl.origin;
        baseUrl = origin;
      } else {
        baseUrl = 'https://rehabilitacios-protetika.hu';
      }
    }

    // Send magic link to the email the user entered (so they receive it at that address)
    await sendPatientMagicLink(email.trim(), patientInfo.name, token, baseUrl);

    return NextResponse.json({
      success: true,
      message: 'Bejelentkezési link elküldve az email címére',
    });
  } catch (error) {
    logger.error('Error requesting magic link:', error);
    return NextResponse.json(
      { error: 'Hiba történt a bejelentkezési link kérésekor' },
      { status: 500 }
    );
  }
}
