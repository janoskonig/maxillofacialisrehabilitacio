import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import bcrypt from 'bcryptjs';
import { logActivity } from '@/lib/activity';

// Jelszó validáció
function isValidPassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 6) {
    return { valid: false, error: 'A jelszónak legalább 6 karakter hosszúnak kell lennie' };
  }
  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    // Hitelesítés ellenőrzése
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { currentPassword, newPassword, confirmPassword } = body;

    // Validációk
    if (!currentPassword || !newPassword || !confirmPassword) {
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

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'Az új jelszónak különböznie kell a jelenlegitől' },
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

    // Jelenlegi jelszó ellenőrzése
    const userResult = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [auth.userId]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Felhasználó nem található' },
        { status: 404 }
      );
    }

    const user = userResult.rows[0];

    // Jelenlegi jelszó ellenőrzése
    const isValidCurrentPassword = await bcrypt.compare(currentPassword, user.password_hash);
    
    if (!isValidCurrentPassword) {
      return NextResponse.json(
        { error: 'A jelenlegi jelszó hibás' },
        { status: 401 }
      );
    }

    // Új jelszó hash-elése
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Jelszó frissítése
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, auth.userId]
    );

    // Activity log
    await logActivity(request, auth.email, 'password_change', 'success');

    return NextResponse.json({
      success: true,
      message: 'Jelszó sikeresen megváltoztatva',
    });
  } catch (error) {
    console.error('Password change error:', error);
    return NextResponse.json(
      { error: 'Jelszó változtatási hiba történt' },
      { status: 500 }
    );
  }
}

