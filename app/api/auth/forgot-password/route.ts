import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email';
import { logActivity } from '@/lib/activity';
import crypto from 'crypto';

/**
 * Rate limiting: maximum 3 password reset requests per hour per email
 */
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email cím megadása kötelező' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const pool = getDbPool();

    // Rate limiting ellenőrzése
    const canProceed = await checkRateLimit(normalizedEmail);
    if (!canProceed) {
      // Biztonsági okokból ugyanazt a választ adjuk vissza
      return NextResponse.json(
        { success: true, message: 'Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket.' },
        { status: 200 }
      );
    }

    // Felhasználó keresése
    const userResult = await pool.query(
      'SELECT id, email, active FROM users WHERE email = $1',
      [normalizedEmail]
    );

    // Biztonsági okokból mindig ugyanazt a választ adjuk vissza
    // függetlenül attól, hogy az email létezik-e
    if (userResult.rows.length === 0) {
      // Activity log (de nem az email címre, hanem egy dummy értékre)
      await logActivity(request, 'unknown', 'password_reset_requested', `attempted_for:${normalizedEmail}`);
      
      return NextResponse.json(
        { success: true, message: 'Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket.' },
        { status: 200 }
      );
    }

    const user = userResult.rows[0];

    // Csak aktív felhasználók kaphatnak reset linket
    if (!user.active) {
      await logActivity(request, normalizedEmail, 'password_reset_requested', 'inactive_user');
      
      return NextResponse.json(
        { success: true, message: 'Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket.' },
        { status: 200 }
      );
    }

    // Biztonságos token generálása
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 óra

    // Token mentése az adatbázisba
    await pool.query(
      'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [resetToken, expiresAt, user.id]
    );

    // Email küldése
    try {
      await sendPasswordResetEmail(normalizedEmail, resetToken, {
        headers: request.headers,
        nextUrl: request.nextUrl,
      });
    } catch (emailError) {
      console.error('Error sending password reset email:', emailError);
      // Ha az email küldés sikertelen, töröljük a tokent
      await pool.query(
        'UPDATE users SET password_reset_token = NULL, password_reset_expires = NULL WHERE id = $1',
        [user.id]
      );
      
      return NextResponse.json(
        { error: 'Hiba történt az email küldésekor. Kérjük próbálja újra később.' },
        { status: 500 }
      );
    }

    // Activity log
    await logActivity(request, normalizedEmail, 'password_reset_requested', 'success');

    return NextResponse.json({
      success: true,
      message: 'Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: 'Hiba történt a jelszó-visszaállítási kérés feldolgozása során' },
      { status: 500 }
    );
  }
}
