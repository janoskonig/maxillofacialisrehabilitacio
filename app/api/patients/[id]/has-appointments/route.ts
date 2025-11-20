import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Ellenőrzi, hogy van-e időpontja egy betegnek
// Optimalizálás: egyetlen lekérdezés helyett a paginated végigjárás helyett
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

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
  } catch (error) {
    console.error('Error checking patient appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpontok ellenőrzésekor' },
      { status: 500 }
    );
  }
}

