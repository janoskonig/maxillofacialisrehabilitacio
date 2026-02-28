import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { sendRegistrationNotificationToAdmins } from '@/lib/email';
import { logActivity } from '@/lib/activity';
import { logger } from '@/lib/logger';

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

// Szerepkör leképezés a felhasználóbarát nevekről az adatbázis szerepkörökre
function mapRoleToDatabaseRole(role: string): string | null {
  const roleMap: Record<string, string> = {
    'sebész': 'sebészorvos',
    'fogpótos': 'fogpótlástanász',
    'technikus': 'technikus',
  };
  return roleMap[role] || null;
}

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, fullName, password, confirmPassword, role, institution, accessReason } = body;

    // Alapvető validációk
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email cím és jelszó megadása kötelező' },
        { status: 400 }
      );
    }

    if (!fullName || !fullName.trim()) {
      return NextResponse.json(
        { error: 'Teljes név megadása kötelező' },
        { status: 400 }
      );
    }

    if (!role) {
      return NextResponse.json(
        { error: 'Szerepkör megadása kötelező' },
        { status: 400 }
      );
    }

    if (!institution) {
      return NextResponse.json(
        { error: 'Intézmény megadása kötelező' },
        { status: 400 }
      );
    }

    if (!accessReason || !accessReason.trim()) {
      return NextResponse.json(
        { error: 'Hozzáférés indokolásának megadása kötelező' },
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

    // Szerepkör leképezése az adatbázis szerepkörre
    const databaseRole = mapRoleToDatabaseRole(role);
    if (!databaseRole) {
      return NextResponse.json(
        { error: 'Érvénytelen szerepkör' },
        { status: 400 }
      );
    }

    // Név tisztítása (trim és normalizálás)
    const cleanedName = fullName.trim();

    // Felhasználó létrehozása (inaktív, admin jóváhagyásra vár)
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny, hozzaferes_indokolas)
       VALUES ($1, $2, $3, false, $4, $5, $6)
       RETURNING id, email, role, active, doktor_neve, intezmeny, hozzaferes_indokolas`,
      [normalizedEmail, passwordHash, databaseRole, cleanedName, institution, accessReason.trim()]
    );

    const user = result.rows[0];

    // NEM hozunk létre JWT tokent - inaktív felhasználó nem jelentkezhet be

    // Activity log
    await logActivity(request, user.email, 'register', 'pending_approval');

    // Email értesítés küldése az adminoknak
    try {
      const adminResult = await pool.query(
        `SELECT email FROM users WHERE role = 'admin' AND active = true`
      );
      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
      
      if (adminEmails.length > 0) {
        await sendRegistrationNotificationToAdmins(
          adminEmails,
          user.email,
          user.doktor_neve || user.email,
          user.role,
          user.intezmeny || institution,
          user.hozzaferes_indokolas || accessReason.trim(),
          new Date()
        );
      }
    } catch (emailError) {
      logger.error('Failed to send registration notification email to admins:', emailError);
      // Nem dobunk hibát, mert a regisztráció sikeres volt
    }

    // Visszatérési válasz - NEM jelentkeztetjük be, mert inaktív
    return NextResponse.json({
      success: true,
      message: 'Regisztráció sikeres! A fiók jóváhagyásra vár. Az admin jóváhagyása után be tud jelentkezni.',
      pendingApproval: true,
    });
  } catch (error) {
    logger.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Regisztrációs hiba történt' },
      { status: 500 }
    );
  }
}

