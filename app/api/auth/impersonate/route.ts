import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { SignJWT } from 'jose';
import { logActivity } from '@/lib/activity';
import { verifyAuth } from '@/lib/auth-server';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

// JWT token lejárat ideje: 7 nap
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 nap milliszekundumban

/**
 * Admin számára lehetővé teszi más felhasználóként való bejelentkezést
 * POST /api/auth/impersonate
 * Body: { userId: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Ellenőrizzük, hogy az aktuális felhasználó admin-e
    const currentAuth = await verifyAuth(request);
    if (!currentAuth || currentAuth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak admin felhasználók használhatják ezt a funkciót' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'Felhasználó ID megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    
    // Felhasználó keresése ID alapján
    const userResult = await pool.query(
      'SELECT id, email, role, active, restricted_view FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Felhasználó nem található' },
        { status: 404 }
      );
    }

    const user = userResult.rows[0];

    // Aktív felhasználó ellenőrzése
    if (!user.active) {
      return NextResponse.json(
        { error: 'A felhasználói fiók inaktív' },
        { status: 403 }
      );
    }

    // JWT token létrehozása az impersonált felhasználó számára
    const token = await new SignJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
      restrictedView: user.restricted_view || false,
      impersonatedBy: currentAuth.userId, // Tároljuk, hogy ki impersonálta
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(JWT_SECRET);

    // Activity log - az admin aktivitását naplózzuk
    await logActivity(request, currentAuth.email, 'impersonate', `Belépés mint: ${user.email}`);

    // Cookie beállítása
    const response = NextResponse.json({
      success: true,
      user: {
        email: user.email,
        role: user.role,
      },
    });

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: JWT_EXPIRES_IN / 1000, // másodpercben
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Impersonate error:', error);
    return NextResponse.json(
      { error: 'Hiba történt a bejelentkezéskor' },
      { status: 500 }
    );
  }
}


