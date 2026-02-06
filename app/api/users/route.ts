import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

// Helper: JWT token ellenőrzése
async function verifyAuth(request: NextRequest): Promise<{ userId: string; email: string; role: string } | null> {
  const token = request.cookies.get('auth-token')?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// Felhasználók listázása (csak admin)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az oldal megtekintéséhez' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const result = await pool.query(
      `SELECT 
        u.id,
        u.email,
        u.doktor_neve,
        u.role,
        u.active,
        u.restricted_view,
        u.intezmeny,
        u.hozzaferes_indokolas,
        u.created_at,
        u.updated_at,
        u.last_login,
        a_last.created_at AS last_activity,
        a_last.action AS last_activity_action,
        a_last.detail AS last_activity_detail
       FROM users u
       LEFT JOIN LATERAL (
         SELECT created_at, action, detail
         FROM activity_logs
         WHERE user_email = u.email
         ORDER BY created_at DESC
         LIMIT 1
       ) a_last ON true
       ORDER BY u.email ASC`
    );

    return NextResponse.json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Hiba történt a felhasználók lekérdezésekor' },
      { status: 500 }
    );
  }
}

// Új felhasználó létrehozása (csak admin)
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága felhasználó létrehozásához' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, password, role = 'editor', doktor_neve } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email cím és jelszó megadása kötelező' },
        { status: 400 }
      );
    }

    if (!['admin', 'editor', 'viewer', 'fogpótlástanász', 'technikus', 'sebészorvos'].includes(role)) {
      return NextResponse.json(
        { error: 'Érvénytelen szerepkör' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    
    // Ellenőrizzük, hogy létezik-e már ilyen email
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: 'Ez az email cím már használatban van' },
        { status: 409 }
      );
    }

    // Jelszó hash-elése
    const passwordHash = await bcrypt.hash(password, 10);

    // Név beállítása: ha meg van adva, akkor azt használjuk, különben email első 3 karaktere
    const userName = doktor_neve || normalizedEmail.substring(0, 3).toUpperCase();

    // Felhasználó létrehozása
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, doktor_neve)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, doktor_neve, role, active, created_at`,
      [normalizedEmail, passwordHash, role, userName]
    );

    return NextResponse.json({ user: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: 'Hiba történt a felhasználó létrehozásakor' },
      { status: 500 }
    );
  }
}

