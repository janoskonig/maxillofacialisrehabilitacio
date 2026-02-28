import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import bcrypt from 'bcryptjs';
import { logActivity } from '@/lib/activity';

function isValidPassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 6) {
    return { valid: false, error: 'A jelszónak legalább 6 karakter hosszúnak kell lennie' };
  }
  return { valid: true };
}

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  const { currentPassword, newPassword, confirmPassword } = body;

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

  const passwordValidation = isValidPassword(newPassword);
  if (!passwordValidation.valid) {
    return NextResponse.json(
      { error: passwordValidation.error },
      { status: 400 }
    );
  }

  const pool = getDbPool();

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

  const isValidCurrentPassword = await bcrypt.compare(currentPassword, user.password_hash);
  
  if (!isValidCurrentPassword) {
    return NextResponse.json(
      { error: 'A jelenlegi jelszó hibás' },
      { status: 401 }
    );
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 10);

  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [newPasswordHash, auth.userId]
  );

  await logActivity(req, auth.email, 'password_change', 'success');

  return NextResponse.json({
    success: true,
    message: 'Jelszó sikeresen megváltoztatva',
  });
});
