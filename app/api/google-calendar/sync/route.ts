import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { syncTimeSlotsFromGoogleCalendar } from '@/lib/google-calendar';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { correlationId, auth }) => {
  const pool = getDbPool();

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
});

export const POST = authedHandler(async (req, { correlationId, auth }) => {
  const pool = getDbPool();

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

  const syncResult = await syncTimeSlotsFromGoogleCalendar(user.id);

  return NextResponse.json({
    success: true,
    result: syncResult,
    message: `Szinkronizáció befejezve: ${syncResult.created} létrehozva, ${syncResult.updated} frissítve, ${syncResult.deleted} törölve`,
  });
});
