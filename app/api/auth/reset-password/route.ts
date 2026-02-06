import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { logActivity } from '@/lib/activity';

// Jelszó validáció (ugyanaz, mint a change-password endpoint-ban)
function isValidPassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 6) {
    return { valid: false, error: 'A jelszónak legalább 6 karakter hosszúnak kell lennie' };
  }
  return { valid: true };
}

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, newPassword, confirmPassword } = body;

    // Validációk
    if (!token || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: 'Minden mező kitöltése kötelező' },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: 'Az új jelszavak nem egyeznek meg' },
        { status: 400 }
      );
    }

    // Jelszó erősség ellenőrzése
    const passwordValidation = isValidPassword(newPassword);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.error },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Token és felhasználó keresése
    const userResult = await pool.query(
      `SELECT id, email, active, password_reset_expires 
       FROM users 
       WHERE password_reset_token = $1`,
      [token]
    );

    if (userResult.rows.length === 0) {
      await logActivity(request, 'unknown', 'password_reset_failed', 'invalid_token');
      
      return NextResponse.json(
        { error: 'Érvénytelen vagy lejárt visszaállítási link' },
        { status: 400 }
      );
    }

    const user = userResult.rows[0];

    // Token lejárat ellenőrzése
    const now = new Date();
    const expiresAt = new Date(user.password_reset_expires);
    
    if (expiresAt < now) {
      // Token törlése
      await pool.query(
        'UPDATE users SET password_reset_token = NULL, password_reset_expires = NULL WHERE id = $1',
        [user.id]
      );
      
      await logActivity(request, user.email, 'password_reset_failed', 'expired_token');
      
      return NextResponse.json(
        { error: 'A visszaállítási link lejárt. Kérjük kérjen új linket.' },
        { status: 400 }
      );
    }

    // Aktív felhasználó ellenőrzése
    if (!user.active) {
      await logActivity(request, user.email, 'password_reset_failed', 'inactive_user');
      
      return NextResponse.json(
        { error: 'A felhasználói fiók inaktív' },
        { status: 403 }
      );
    }

    // Új jelszó hash-elése
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Jelszó frissítése és token törlése
    await pool.query(
      `UPDATE users 
       SET password_hash = $1, 
           password_reset_token = NULL, 
           password_reset_expires = NULL,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [newPasswordHash, user.id]
    );

    // Activity log
    await logActivity(request, user.email, 'password_reset_completed', 'success');

    return NextResponse.json({
      success: true,
      message: 'Jelszó sikeresen visszaállítva. Most már be tud jelentkezni az új jelszavával.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: 'Hiba történt a jelszó-visszaállítás során' },
      { status: 500 }
    );
  }
}
