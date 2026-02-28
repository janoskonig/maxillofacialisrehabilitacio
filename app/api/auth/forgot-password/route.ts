import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email';
import { logActivity } from '@/lib/activity';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import crypto from 'crypto';

async function checkRateLimit(email: string): Promise<boolean> {
  const pool = getDbPool();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const result = await pool.query(
    `SELECT COUNT(*) as count 
     FROM activity_logs 
     WHERE user_email = $1 
       AND action = 'password_reset_requested' 
       AND created_at > $2`,
    [email, oneHourAgo]
  );

  const count = parseInt(result.rows[0].count, 10);
  return count < 3;
}

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const { email } = body;

  if (!email || typeof email !== 'string') {
    return NextResponse.json(
      { error: 'Email cím megadása kötelező' },
      { status: 400 }
    );
  }

  const normalizedEmail = email.toLowerCase().trim();
  const pool = getDbPool();

  const canProceed = await checkRateLimit(normalizedEmail);
  if (!canProceed) {
    return NextResponse.json(
      { success: true, message: 'Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket.' },
      { status: 200 }
    );
  }

  const userResult = await pool.query(
    'SELECT id, email, active FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (userResult.rows.length === 0) {
    await logActivity(req, 'unknown', 'password_reset_requested', `attempted_for:${normalizedEmail}`);
    
    return NextResponse.json(
      { success: true, message: 'Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket.' },
      { status: 200 }
    );
  }

  const user = userResult.rows[0];

  if (!user.active) {
    await logActivity(req, normalizedEmail, 'password_reset_requested', 'inactive_user');
    
    return NextResponse.json(
      { success: true, message: 'Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket.' },
      { status: 200 }
    );
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await pool.query(
    'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
    [resetToken, expiresAt, user.id]
  );

  try {
    await sendPasswordResetEmail(normalizedEmail, resetToken, {
      headers: req.headers,
      nextUrl: req.nextUrl,
    });
  } catch (emailError) {
    logger.error('Error sending password reset email:', emailError);
    await pool.query(
      'UPDATE users SET password_reset_token = NULL, password_reset_expires = NULL WHERE id = $1',
      [user.id]
    );
    
    return NextResponse.json(
      { error: 'Hiba történt az email küldésekor. Kérjük próbálja újra később.' },
      { status: 500 }
    );
  }

  await logActivity(req, normalizedEmail, 'password_reset_requested', 'success');

  return NextResponse.json({
    success: true,
    message: 'Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket.',
  });
});
