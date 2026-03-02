import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { syncMissingAppointmentsToGoogleCalendar } from '@/lib/google-calendar';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { correlationId, auth }) => {
  const pool = getDbPool();

  const userResult = await pool.query(
    `SELECT id, google_calendar_enabled FROM users WHERE email = $1`,
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

  const results = await syncMissingAppointmentsToGoogleCalendar(user.id);

  return NextResponse.json({
    success: true,
    message:
      results.total === 0
        ? 'Nincs szinkronizálandó időpont'
        : `${results.synced} időpont sikeresen szinkronizálva a Google Naptárba${results.errors.length > 0 ? `, ${results.errors.length} hiba` : ''}`,
    results,
  });
});
