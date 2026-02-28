import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  const result = await pool.query(
    `SELECT 
      p.id,
      p.nev,
      p.taj,
      p.telefonszam,
      p.szuletesi_datum as "szuletesiDatum",
      p.nem,
      p.email,
      p.cim,
      p.varos,
      p.iranyitoszam,
      p.felvetel_datuma as "felvetelDatuma",
      r.beutalo_orvos as "beutaloOrvos",
      r.beutalo_indokolas as "beutaloIndokolas",
      p.kezeleoorvos
    FROM patients p
    LEFT JOIN patient_referral r ON r.patient_id = p.id
    WHERE p.id = $1`,
    [patientId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    patient: result.rows[0],
  });
});

export const PUT = apiHandler(async (req, { correlationId }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const body = await req.json();
  const {
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

  if (!nev || !nev.trim()) {
    return NextResponse.json(
      { error: 'A név megadása kötelező' },
      { status: 400 }
    );
  }

  if (!szuletesiDatum) {
    return NextResponse.json(
      { error: 'A születési dátum megadása kötelező' },
      { status: 400 }
    );
  }

  if (!nem || !['ferfi', 'no', 'nem_ismert'].includes(nem)) {
    return NextResponse.json(
      { error: 'Érvényes nem megadása kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  const checkResult = await pool.query(
    'SELECT id FROM patients WHERE id = $1',
    [patientId]
  );

  if (checkResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  const patientUpdateFields: string[] = [];
  const patientUpdateValues: any[] = [];
  let paramIndex = 1;

  patientUpdateFields.push(`nev = $${paramIndex}`);
  patientUpdateValues.push(nev.trim());
  paramIndex++;

  patientUpdateFields.push(`telefonszam = $${paramIndex}`);
  patientUpdateValues.push(telefonszam?.trim() || null);
  paramIndex++;

  patientUpdateFields.push(`szuletesi_datum = $${paramIndex}`);
  patientUpdateValues.push(szuletesiDatum);
  paramIndex++;

  patientUpdateFields.push(`nem = $${paramIndex}`);
  patientUpdateValues.push(nem);
  paramIndex++;

  patientUpdateFields.push(`cim = $${paramIndex}`);
  patientUpdateValues.push(cim?.trim() || null);
  paramIndex++;

  patientUpdateFields.push(`varos = $${paramIndex}`);
  patientUpdateValues.push(varos?.trim() || null);
  paramIndex++;

  patientUpdateFields.push(`iranyitoszam = $${paramIndex}`);
  patientUpdateValues.push(iranyitoszam?.trim() || null);
  paramIndex++;

  patientUpdateFields.push(`updated_at = CURRENT_TIMESTAMP`);
  patientUpdateValues.push(patientId);

  await pool.query(
    `UPDATE patients 
     SET ${patientUpdateFields.join(', ')}
     WHERE id = $${paramIndex}`,
    patientUpdateValues
  );

  // Update patient_referral for referral fields (always included in PUT body)
  await pool.query(
    `INSERT INTO patient_referral (patient_id, beutalo_orvos, beutalo_indokolas)
     VALUES ($1, $2, $3)
     ON CONFLICT (patient_id) DO UPDATE SET
       beutalo_orvos = EXCLUDED.beutalo_orvos,
       beutalo_indokolas = EXCLUDED.beutalo_indokolas`,
    [patientId, beutaloOrvos?.trim() || null, beutaloIndokolas?.trim() || null]
  );

  const result = await pool.query(
    `SELECT 
      p.id,
      p.nev,
      p.taj,
      p.telefonszam,
      p.szuletesi_datum as "szuletesiDatum",
      p.nem,
      p.email,
      p.cim,
      p.varos,
      p.iranyitoszam,
      p.felvetel_datuma as "felvetelDatuma",
      r.beutalo_orvos as "beutaloOrvos",
      r.beutalo_indokolas as "beutaloIndokolas"
    FROM patients p
    LEFT JOIN patient_referral r ON r.patient_id = p.id
    WHERE p.id = $1`,
    [patientId]
  );

  return NextResponse.json({
    success: true,
    patient: result.rows[0],
    message: 'Adatok sikeresen frissítve',
  });
});
