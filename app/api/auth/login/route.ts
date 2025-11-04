import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

// JWT token lejárat ideje: 7 nap
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 nap milliszekundumban

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email cím és jelszó megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    
    // Felhasználó keresése email alapján
    const userResult = await pool.query(
      'SELECT id, email, password_hash, role, active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (userResult.rows.length === 0) {
      // Biztonsági okokból ugyanazt a hibaüzenetet adjuk vissza
      return NextResponse.json(
        { error: 'Hibás email cím vagy jelszó' },
        { status: 401 }
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

    // Jelszó ellenőrzése
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return NextResponse.json(
        { error: 'Hibás email cím vagy jelszó' },
        { status: 401 }
      );
    }

    // JWT token létrehozása
    const token = await new SignJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(JWT_SECRET);

    // Last login frissítése
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Activity log
    try {
      await pool.query(
        'INSERT INTO activity_logs (user_email, action, detail, ip_address) VALUES ($1, $2, $3, $4)',
        [
          user.email,
          'login',
          'success',
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        ]
      );
    } catch (e) {
      // Nem kritikus hiba, csak logoljuk
      console.error('Failed to log login activity:', e);
    }

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
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Bejelentkezési hiba történt' },
      { status: 500 }
    );
  }
}

