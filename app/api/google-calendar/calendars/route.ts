import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { listGoogleCalendars } from '@/lib/google-calendar';
import { getDbPool } from '@/lib/db';

/**
 * Google Calendar naptárak listázása
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
    
    // Ellenőrizzük, hogy a felhasználó Google Calendar-hoz kapcsolva van-e
    const userResult = await pool.query(
      `SELECT id, email, google_calendar_enabled, 
              google_calendar_source_calendar_id, 
              google_calendar_target_calendar_id
       FROM users 
       WHERE email = $1`,
      [auth.email]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Felhasználó nem található' },
        { status: 404 }
      );
    }

    const user = userResult.rows[0];
    
    if (!user.google_calendar_enabled) {
      return NextResponse.json(
        { error: 'Google Calendar nincs összekötve' },
        { status: 400 }
      );
    }

    // Lekérjük a Google Calendar naptárakat
    const calendars = await listGoogleCalendars(user.id);
    console.log(`[Calendars API] Found ${calendars.length} calendars for user ${user.id}`);
    
    // Ha nincs naptár, akkor is adjunk vissza egy üres tömböt, hogy a UI megjelenjen
    return NextResponse.json({
      calendars: calendars.length > 0 ? calendars : [{ id: 'primary', summary: 'Alapértelmezett naptár' }],
      sourceCalendarId: user.google_calendar_source_calendar_id || 'primary',
      targetCalendarId: user.google_calendar_target_calendar_id || 'primary',
    });
  } catch (error) {
    console.error('Error fetching Google Calendar calendars:', error);
    return NextResponse.json(
      { error: 'Hiba történt a naptárak lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Google Calendar naptár beállítások mentése
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { sourceCalendarId, targetCalendarId } = body;

    if (!sourceCalendarId || !targetCalendarId) {
      return NextResponse.json(
        { error: 'Forrás és cél naptár megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    
    // Ellenőrizzük, hogy a felhasználó Google Calendar-hoz kapcsolva van-e
    const userResult = await pool.query(
      `SELECT id, email, google_calendar_enabled
       FROM users 
       WHERE email = $1`,
      [auth.email]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Felhasználó nem található' },
        { status: 404 }
      );
    }

    const user = userResult.rows[0];
    
    if (!user.google_calendar_enabled) {
      return NextResponse.json(
        { error: 'Google Calendar nincs összekötve' },
        { status: 400 }
      );
    }

    // Beállítások mentése
    await pool.query(
      `UPDATE users 
       SET google_calendar_source_calendar_id = $1,
           google_calendar_target_calendar_id = $2
       WHERE id = $3`,
      [sourceCalendarId, targetCalendarId, user.id]
    );

    return NextResponse.json({
      success: true,
      message: 'Naptár beállítások sikeresen mentve',
      sourceCalendarId,
      targetCalendarId,
    });
  } catch (error) {
    console.error('Error saving Google Calendar calendar settings:', error);
    return NextResponse.json(
      { error: 'Hiba történt a beállítások mentésekor' },
      { status: 500 }
    );
  }
}

