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
        felvetel_datuma as "felvetelDatuma"
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





