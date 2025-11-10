import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth, AuthPayload } from '@/lib/auth-server';

// Fogpótlástanász szerepű felhasználók lekérdezése
// Ez az endpoint a kezelőorvos választáshoz használatos
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
    
    // Fogpótlástanász és admin szerepű, aktív felhasználók lekérdezése
    const result = await pool.query(
      `SELECT 
        id,
        email,
        doktor_neve,
        role,
        active
       FROM users
       WHERE (role = 'fogpótlástanász' OR role = 'admin') AND active = true
       ORDER BY COALESCE(doktor_neve, email) ASC`
    );

    // Formázott lista visszaadása (név vagy email alapján)
    const users = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.doktor_neve || row.email, // Ha nincs név, akkor email
      displayName: row.doktor_neve || row.email, // Megjelenítendő név
    }));

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error fetching fogpótlástanász users:', error);
    return NextResponse.json(
      { error: 'Hiba történt a felhasználók lekérdezésekor' },
      { status: 500 }
    );
  }
}

