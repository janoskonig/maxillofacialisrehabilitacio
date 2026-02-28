import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { logActivity } from '@/lib/activity';
import { apiHandler } from '@/lib/api/route-handler';

function isValidPassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 6) {
    return { valid: false, error: 'A jelszónak legalább 6 karakter hosszúnak kell lennie' };
  }
  return { valid: true };
}

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const { token, newPassword, confirmPassword } = body;

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

  const passwordValidation = isValidPassword(newPassword);
  if (!passwordValidation.valid) {
    return NextResponse.json(
      { error: passwordValidation.error },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  const userResult = await pool.query(
    `SELECT id, email, active, password_reset_expires 
     FROM users 
     WHERE password_reset_token = $1`,
    [token]
  );

  if (userResult.rows.length === 0) {
    await logActivity(req, 'unknown', 'password_reset_failed', 'invalid_token');
    
    return NextResponse.json(
      { error: 'Érvénytelen vagy lejárt visszaállítási link' },
      { status: 400 }
    );
  }

  const user = userResult.rows[0];

  const now = new Date();
  const expiresAt = new Date(user.password_reset_expires);
  
  if (expiresAt < now) {
    await pool.query(
      'UPDATE users SET password_reset_token = NULL, password_reset_expires = NULL WHERE id = $1',
      [user.id]
    );
    
    await logActivity(req, user.email, 'password_reset_failed', 'expired_token');
    
    return NextResponse.json(
      { error: 'A visszaállítási link lejárt. Kérjük kérjen új linket.' },
      { status: 400 }
    );
  }

  if (!user.active) {
    await logActivity(req, user.email, 'password_reset_failed', 'inactive_user');
    
    return NextResponse.json(
      { error: 'A felhasználói fiók inaktív' },
      { status: 403 }
    );
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 10);

  await pool.query(
    `UPDATE users 
     SET password_hash = $1, 
         password_reset_token = NULL, 
         password_reset_expires = NULL,
         updated_at = CURRENT_TIMESTAMP 
     WHERE id = $2`,
    [newPasswordHash, user.id]
  );

  await logActivity(req, user.email, 'password_reset_completed', 'success');

  return NextResponse.json({
    success: true,
    message: 'Jelszó sikeresen visszaállítva. Most már be tud jelentkezni az új jelszavával.',
  });
});
