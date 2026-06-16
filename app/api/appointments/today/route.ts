import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { fetchTodaysAppointments } from '@/lib/queries/todays-appointments';

export const dynamic = 'force-dynamic';

// A mai időpontok dedikált oldalának adatforrása. Ugyanazt a lekérdezést használja,
// mint a főoldali dashboard widget (lib/queries/todays-appointments.ts), így a
// `rebookNeeded` számítás és a mezők egységesek.
export const GET = authedHandler(async () => {
  const pool = getDbPool();
  const appointments = await fetchTodaysAppointments(pool);
  return NextResponse.json({ appointments });
});
