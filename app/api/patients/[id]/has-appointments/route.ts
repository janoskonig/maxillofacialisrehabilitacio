import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

// Ellenőrzi, hogy van-e időpontja egy betegnek
// Optimalizálás: egyetlen lekérdezés helyett a paginated végigjárás helyett
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  // Egyszerű COUNT lekérdezés - sokkal gyorsabb mint a paginated végigjárás
  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM appointments
     WHERE patient_id = $1`,
    [patientId]
  );

  const count = parseInt(result.rows[0].count, 10);
  const hasAppointments = count > 0;

  return NextResponse.json({
    hasAppointments,
    count
  }, { status: 200 });
});

