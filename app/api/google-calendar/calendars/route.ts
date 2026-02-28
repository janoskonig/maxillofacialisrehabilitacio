import { NextResponse } from 'next/server';
import { listGoogleCalendars } from '@/lib/google-calendar';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { correlationId, auth }) => {
  const pool = getDbPool();

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

  const calendars = await listGoogleCalendars(user.id);
  logger.info(`[Calendars API] Found ${calendars.length} calendars for user ${user.id}`);

  return NextResponse.json({
    calendars: calendars.length > 0 ? calendars : [{ id: 'primary', summary: 'Alapértelmezett naptár' }],
    sourceCalendarId: user.google_calendar_source_calendar_id || 'primary',
    targetCalendarId: user.google_calendar_target_calendar_id || 'primary',
  });
});

export const PUT = authedHandler(async (req, { correlationId, auth }) => {
  const body = await req.json();
  const { sourceCalendarId, targetCalendarId } = body;

  if (!sourceCalendarId || !targetCalendarId) {
    return NextResponse.json(
      { error: 'Forrás és cél naptár megadása kötelező' },
      { status: 400 }
    );
  }

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
});
