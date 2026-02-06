import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getDbPool } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json(
        { error: 'Nincs bejelentkezve' },
        { status: 401 }
      );
    }

    // JWT token ellenőrzése
    const { payload } = await jwtVerify(token, JWT_SECRET);

    const userId = payload.userId as string;
    const email = payload.email as string;
    const role = payload.role as string;

    // Ellenőrizzük, hogy a felhasználó még aktív-e
    const pool = getDbPool();
    const userResult = await pool.query(
      'SELECT email, role, active, restricted_view, intezmeny, doktor_neve FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].active) {
      return NextResponse.json(
        { error: 'Felhasználó nem található vagy inaktív' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: userId,
        email: userResult.rows[0].email,
        role: userResult.rows[0].role,
        restrictedView: userResult.rows[0].restricted_view || false,
        intezmeny: userResult.rows[0].intezmeny || null,
        name: userResult.rows[0].doktor_neve || null,
      },
    });
  } catch (error) {
    console.error('Auth verification error:', error);
    return NextResponse.json(
      { error: 'Hitelesítési hiba' },
      { status: 401 }
    );
  }
}

