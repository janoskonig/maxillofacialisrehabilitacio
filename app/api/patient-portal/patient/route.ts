import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';

/**
 * Get patient's own data (limited subset)
 * GET /api/patient-portal/patient
 */
export async function GET(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Get limited patient data (only what patients should see)
    const result = await pool.query(
      `SELECT 
        id,
        nev,
        taj,
        telefonszam,
        szuletesi_datum as "szuletesiDatum",
        nem,
        email,
        cim,
        varos,
        iranyitoszam,
        felvetel_datuma as "felvetelDatuma",
        beutalo_orvos as "beutaloOrvos",
        beutalo_indokolas as "beutaloIndokolas"
      FROM patients
      WHERE id = $1`,
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
  } catch (error) {
    console.error('Error fetching patient data:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Update patient's own data (only basic personal info)
 * PUT /api/patient-portal/patient
 */
export async function PUT(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
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

    // Validate required fields
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

    // Verify patient exists
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

    // Update patient data (only allowed fields)
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    updateFields.push(`nev = $${paramIndex}`);
    updateValues.push(nev.trim());
    paramIndex++;

    updateFields.push(`telefonszam = $${paramIndex}`);
    updateValues.push(telefonszam?.trim() || null);
    paramIndex++;

    updateFields.push(`szuletesi_datum = $${paramIndex}`);
    updateValues.push(szuletesiDatum);
    paramIndex++;

    updateFields.push(`nem = $${paramIndex}`);
    updateValues.push(nem);
    paramIndex++;

    updateFields.push(`cim = $${paramIndex}`);
    updateValues.push(cim?.trim() || null);
    paramIndex++;

    updateFields.push(`varos = $${paramIndex}`);
    updateValues.push(varos?.trim() || null);
    paramIndex++;

    updateFields.push(`iranyitoszam = $${paramIndex}`);
    updateValues.push(iranyitoszam?.trim() || null);
    paramIndex++;

    updateFields.push(`beutalo_orvos = $${paramIndex}`);
    updateValues.push(beutaloOrvos?.trim() || null);
    paramIndex++;

    updateFields.push(`beutalo_indokolas = $${paramIndex}`);
    updateValues.push(beutaloIndokolas?.trim() || null);
    paramIndex++;

    // Always update updated_at
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(patientId);

    await pool.query(
      `UPDATE patients 
       SET ${updateFields.join(', ')}
       WHERE id = $${paramIndex}`,
      updateValues
    );

    // Fetch updated patient data
    const result = await pool.query(
      `SELECT 
        id,
        nev,
        taj,
        telefonszam,
        szuletesi_datum as "szuletesiDatum",
        nem,
        email,
        cim,
        varos,
        iranyitoszam,
        felvetel_datuma as "felvetelDatuma",
        beutalo_orvos as "beutaloOrvos",
        beutalo_indokolas as "beutaloIndokolas"
      FROM patients
      WHERE id = $1`,
      [patientId]
    );

    return NextResponse.json({
      success: true,
      patient: result.rows[0],
      message: 'Adatok sikeresen frissítve',
    });
  } catch (error) {
    console.error('Error updating patient data:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok frissítésekor' },
      { status: 500 }
    );
  }
}
