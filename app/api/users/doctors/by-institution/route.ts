import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

/**
 * GET /api/users/doctors/by-institution?institution=xxx - Orvosok lekérése intézmény szerint
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const institution = searchParams.get('institution');

    if (!institution) {
      return NextResponse.json(
        { error: 'Intézmény megadása kötelező' },
        { status: 400 }
      );
    }

    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az orvosok listázásához' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    
    // Összes aktív orvos az adott intézményből
    const result = await pool.query(
      `SELECT id, email, doktor_neve, intezmeny
       FROM users
       WHERE intezmeny = $1
         AND doktor_neve IS NOT NULL 
         AND doktor_neve != ''
         AND active = true
         AND (role IN ('sebészorvos', 'fogpótlástanász', 'admin') OR doktor_neve IS NOT NULL)
       ORDER BY doktor_neve ASC`,
      [institution]
    );

    const doctors = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.doktor_neve,
      intezmeny: row.intezmeny || null,
    }));

    return NextResponse.json({ doctors });
  } catch (error) {
    logger.error('Error fetching doctors by institution:', error);
    return NextResponse.json(
      { error: 'Hiba történt az orvosok lekérdezésekor' },
      { status: 500 }
    );
  }
}

