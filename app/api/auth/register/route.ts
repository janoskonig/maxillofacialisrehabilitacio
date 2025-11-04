import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 nap

// Email validáció
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Jelszó validáció
function isValidPassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 6) {
    return { valid: false, error: 'A jelszónak legalább 6 karakter hosszúnak kell lennie' };
  }
  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, confirmPassword } = body;

    // Alapvető validációk
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email cím és jelszó megadása kötelező' },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: 'A jelszavak nem egyeznek meg' },
        { status: 400 }
      );
    }

    // Email formátum ellenőrzése
    const normalizedEmail = email.toLowerCase().trim();
    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Érvénytelen email cím formátum' },
        { status: 400 }
      );
    }

    // Jelszó erősség ellenőrzése
    const passwordValidation = isValidPassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.error },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    
    // Ellenőrizzük, hogy létezik-e már ilyen email
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      return NextResponse.json(
        { error: 'Ez az email cím már használatban van' },
        { status: 409 }
      );
    }

    // Jelszó hash-elése
    const passwordHash = await bcrypt.hash(password, 10);

    // Alapértelmezett szerepkör: editor (módosítható)
    const defaultRole = 'editor';

    // Felhasználó létrehozása (inaktív, admin jóváhagyásra vár)
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, active)
       VALUES ($1, $2, $3, false)
       RETURNING id, email, role, active`,
      [normalizedEmail, passwordHash, defaultRole]
    );

    const user = result.rows[0];

    // NEM hozunk létre JWT tokent - inaktív felhasználó nem jelentkezhet be

    // Activity log
    try {
      await pool.query(
        'INSERT INTO activity_logs (user_email, action, detail, ip_address) VALUES ($1, $2, $3, $4)',
        [
          user.email,
          'register',
          'pending_approval',
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        ]
      );
    } catch (e) {
      console.error('Failed to log registration activity:', e);
    }

    // Visszatérési válasz - NEM jelentkeztetjük be, mert inaktív
    return NextResponse.json({
      success: true,
      message: 'Regisztráció sikeres! A fiók jóváhagyásra vár. Az admin jóváhagyása után be tud jelentkezni.',
      pendingApproval: true,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Regisztrációs hiba történt' },
      { status: 500 }
    );
  }
}

