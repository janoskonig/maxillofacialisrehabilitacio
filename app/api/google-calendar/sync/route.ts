import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { syncTimeSlotsFromGoogleCalendar } from '@/lib/google-calendar';

/**
 * Szinkronizációs státusz lekérdezése
 */
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
    
    return NextResponse.json({
      connected: user.google_calendar_enabled === true,
      userId: user.id,
    });
  } catch (error) {
    console.error('Error fetching sync status:', error);
    return NextResponse.json(
      { error: 'Hiba történt a szinkronizációs státusz lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Manuális szinkronizáció indítása
 */
export async function POST(request: NextRequest) {
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

    // Szinkronizálás indítása
    const syncResult = await syncTimeSlotsFromGoogleCalendar(user.id);
    
    return NextResponse.json({
      success: true,
      result: syncResult,
      message: `Szinkronizáció befejezve: ${syncResult.created} létrehozva, ${syncResult.updated} frissítve, ${syncResult.deleted} törölve`,
    });
  } catch (error) {
    console.error('Error syncing Google Calendar:', error);
    return NextResponse.json(
      { 
        error: 'Hiba történt a szinkronizáció során',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}




