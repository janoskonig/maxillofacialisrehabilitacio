import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth, AuthPayload } from '@/lib/auth-server';

// Orvos neve alapján intézmény lekérdezése
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

    const { searchParams } = new URL(request.url);
    const doctorName = searchParams.get('name');
    
    if (!doctorName) {
      return NextResponse.json(
        { error: 'Orvos neve megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    
    // Keresés doktor_neve alapján (részleges egyezés is)
    const result = await pool.query(
      `SELECT 
        doktor_neve,
        intezmeny
       FROM users
       WHERE doktor_neve ILIKE $1 AND intezmeny IS NOT NULL AND intezmeny != ''
       ORDER BY doktor_neve ASC
       LIMIT 1`,
      [`%${doctorName}%`]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ intezmeny: null });
    }

    return NextResponse.json({ 
      intezmeny: result.rows[0].intezmeny,
      doktor_neve: result.rows[0].doktor_neve
    });
  } catch (error) {
    console.error('Error fetching institution by doctor name:', error);
    return NextResponse.json(
      { error: 'Hiba történt az intézmény lekérdezésekor' },
      { status: 500 }
    );
  }
}




