import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';

/**
 * Get available time slots for patient portal
 * GET /api/patient-portal/time-slots
 */
export const dynamic = 'force-dynamic';

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

    // Always filter for future and available time slots only
    const whereClause = `WHERE ats.start_time >= NOW() AND ats.status = 'available'`;
    const queryParams: unknown[] = [];

    const query = `
      SELECT 
        ats.id,
        ats.start_time as "startTime",
        ats.status,
        ats.cim,
        ats.teremszam,
        u.email as "dentistEmail",
        u.doktor_neve as "dentistName"
      FROM available_time_slots ats
      LEFT JOIN users u ON ats.user_id = u.id
      ${whereClause}
      ORDER BY ats.start_time ASC
      LIMIT 50
    `;

    const result = await pool.query(query, queryParams);

    return NextResponse.json({
      timeSlots: result.rows,
    });
  } catch (error) {
    console.error('Hiba az elérhető időpontok lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az elérhető időpontok lekérdezésekor' },
      { status: 500 }
    );
  }
}





