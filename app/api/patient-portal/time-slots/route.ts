import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';

/**
 * Get available time slots for patient portal
 * GET /api/patient-portal/time-slots
 * Query params: dentistEmail (optional), page (default 1), limit (default 50)
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
    const searchParams = request.nextUrl.searchParams;
    const dentistEmail = searchParams.get('dentistEmail');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    const queryParams: unknown[] = [];
    const conditions: string[] = ['ats.start_time >= NOW()', "ats.status = 'available'", "ats.slot_purpose IN ('consult', 'flexible')"];
    if (dentistEmail && dentistEmail.trim()) {
      conditions.push('u.email = $1');
      queryParams.push(dentistEmail.trim());
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    queryParams.push(offset, limit);
    const offsetParam = queryParams.length - 1;
    const limitParam = queryParams.length;

    const slotsQuery = `
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
      OFFSET $${offsetParam} LIMIT $${limitParam}
    `;

    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM available_time_slots ats
      LEFT JOIN users u ON ats.user_id = u.id
      ${whereClause}
    `;

    const doctorsQuery = `
      SELECT DISTINCT u.email, u.doktor_neve as "dentistName"
      FROM available_time_slots ats
      LEFT JOIN users u ON ats.user_id = u.id
      ${whereClause}
      ORDER BY u.doktor_neve ASC
    `;

    const [slotsResult, countResult, doctorsResult] = await Promise.all([
      pool.query(slotsQuery, queryParams),
      pool.query(countQuery, queryParams.slice(0, -2)),
      pool.query(doctorsQuery, queryParams.slice(0, -2)),
    ]);

    const total = countResult.rows[0]?.total ?? 0;
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      timeSlots: slotsResult.rows,
      doctors: doctorsResult.rows
        .filter((r: { email: string | null }) => r.email)
        .map((r: { email: string; dentistName: string | null }) => ({
          email: r.email,
          name: r.dentistName || r.email,
        })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Hiba az elérhető időpontok lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az elérhető időpontok lekérdezésekor' },
      { status: 500 }
    );
  }
}





