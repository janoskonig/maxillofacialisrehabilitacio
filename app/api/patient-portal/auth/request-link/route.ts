import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createMagicLinkToken, checkRegistrationRateLimit } from '@/lib/patient-portal-auth';
import { sendPatientMagicLink, getPatientEmailInfo } from '@/lib/patient-portal-email';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req, { correlationId }) => {
  const body = await req.json();
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
    beutaloIndokolas,
  } = body;

  if (!email || !taj) {
    return NextResponse.json(
      { error: 'Email cím és TAJ szám megadása kötelező' },
      { status: 400 }
    );
  }

  const cleanTaj = taj.replace(/[-\s]/g, '');

  if (!/^\d{9}$/.test(cleanTaj)) {
    return NextResponse.json(
      { error: 'Érvénytelen TAJ szám formátum' },
      { status: 400 }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return NextResponse.json(
      { error: 'Érvénytelen email cím formátum' },
      { status: 400 }
    );
  }

  const ipHeader = req.headers.get('x-forwarded-for') || '';
  const ipAddress = ipHeader.split(',')[0]?.trim() || null;

  if (ipAddress && !(await checkRegistrationRateLimit(ipAddress))) {
    return NextResponse.json(
      { error: 'Túl sok kísérlet. Kérjük próbálja újra később.' },
      { status: 429 }
    );
  }

  const pool = getDbPool();

  const patientResult = await pool.query(
    `SELECT id, email, nev, taj 
     FROM patients 
     WHERE REPLACE(REPLACE(taj, '-', ''), ' ', '') = $1`,
    [cleanTaj]
  );

  let patientId: string;
  const isNewPatient = patientResult.rows.length === 0;

  if (isNewPatient) {
    const formattedTaj = `${cleanTaj.slice(0, 3)}-${cleanTaj.slice(3, 6)}-${cleanTaj.slice(6)}`;
    
    const insertFields: string[] = ['email', 'taj'];
    const insertValues: any[] = [email.trim(), formattedTaj];

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

    insertFields.push('created_at', 'updated_at');

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
    patientId = patientResult.rows[0].id;
    const existingEmail = (patientResult.rows[0].email || '').trim();

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

  const token = await createMagicLinkToken(patientId, ipAddress);

  const patientInfo = await getPatientEmailInfo(patientId);
  if (!patientInfo) {
    return NextResponse.json(
      { error: 'Hiba történt az email küldésekor' },
      { status: 500 }
    );
  }

  let baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    if (process.env.NODE_ENV === 'development') {
      const origin = req.headers.get('origin') || req.nextUrl.origin;
      baseUrl = origin;
    } else {
      baseUrl = 'https://rehabilitacios-protetika.hu';
    }
  }

  await sendPatientMagicLink(email.trim(), patientInfo.name, token, baseUrl);

  return NextResponse.json({
    success: true,
    message: 'Bejelentkezési link elküldve az email címére',
  });
});
