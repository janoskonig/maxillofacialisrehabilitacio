import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth, AuthPayload } from '@/lib/auth-server';

// Összes orvos nevének lekérdezése (beutaló orvos ajánlásokhoz)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Ellenőrizzük, hogy a felhasználó be van-e jelentkezve
    const auth: AuthPayload | null = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az oldal megtekintéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const forSlotPicker = request.nextUrl.searchParams.get('forSlotPicker') === '1';

    // Összes aktív felhasználó, akinek van doktor_neve (orvos szerepkörök és admin)
    // forSlotPicker: csak admin és fogpótlástanász (időpontválasztó modal szűrőjéhez)
    const roleCondition = forSlotPicker
      ? `AND role IN ('admin', 'fogpótlástanász')`
      : `AND (role IN ('sebészorvos', 'fogpótlástanász', 'admin') OR doktor_neve IS NOT NULL)`;
    const result = await pool.query(
      `SELECT DISTINCT id, email, doktor_neve, intezmeny
       FROM users
       WHERE doktor_neve IS NOT NULL 
         AND doktor_neve != ''
         AND active = true
         ${roleCondition}
       ORDER BY doktor_neve ASC`
    );

    const doctors = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.doktor_neve,
      intezmeny: row.intezmeny || null,
    }));

    return NextResponse.json({ doctors });
  } catch (error) {
    console.error('Error fetching doctors:', error);
    return NextResponse.json(
      { error: 'Hiba történt az orvosok lekérdezésekor' },
      { status: 500 }
    );
  }
}




