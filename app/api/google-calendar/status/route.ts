import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Google Calendar kapcsolat státusz lekérdezése
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const result = await pool.query(
      `SELECT 
        google_calendar_enabled,
        google_calendar_email,
        google_calendar_status,
        google_calendar_last_error_code,
        google_calendar_last_error_at
      FROM users 
      WHERE id = $1`,
      [auth.userId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Felhasználó nem található' },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    return NextResponse.json({
      enabled: row.google_calendar_enabled || false,
      email: row.google_calendar_email || null,
      status: row.google_calendar_status || 'active',
      lastErrorCode: row.google_calendar_last_error_code || null,
      lastErrorAt: row.google_calendar_last_error_at || null,
    });
  } catch (error) {
    logger.error('Error fetching Google Calendar status:', error);
    return NextResponse.json(
      { error: 'Hiba történt a státusz lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Google Calendar kapcsolat megszüntetése
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    await pool.query(
      `UPDATE users 
       SET google_calendar_enabled = false,
           google_calendar_refresh_token = NULL,
           google_calendar_access_token = NULL,
           google_calendar_token_expires_at = NULL,
           google_calendar_email = NULL
       WHERE id = $1`,
      [auth.userId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error disconnecting Google Calendar:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kapcsolat megszüntetésekor' },
      { status: 500 }
    );
  }
}

