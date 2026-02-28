import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

interface WeekBucket {
  weekStart: string;
  weekLabel: string;
  supply: number;
  hardDemand: number;
  softDemand: number;
}

/**
 * GET /api/capacity-forecast
 * Query: pool (consult|work|control), weeks (default 12)
 */
export const GET = roleHandler(['admin', 'sebészorvos', 'fogpótlástanász'], async (req, { auth }) => {
  const searchParams = req.nextUrl.searchParams;
  const poolFilter = searchParams.get('pool') ?? 'work';
  const weeksAhead = Math.min(parseInt(searchParams.get('weeks') ?? '12', 10), 52);

  const dbPool = getDbPool();

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1);
  startOfWeek.setHours(0, 0, 0, 0);

  const endDate = new Date(startOfWeek);
  endDate.setDate(endDate.getDate() + weeksAhead * 7);

  const supplyResult = await dbPool.query(
    `SELECT date_trunc('week', start_time) as week_start, COUNT(*)::int as cnt
     FROM available_time_slots
     WHERE state = 'free'
       AND (slot_purpose = $1 OR slot_purpose IS NULL)
       AND start_time >= $2
       AND start_time < $3
     GROUP BY week_start
     ORDER BY week_start`,
    [poolFilter, startOfWeek.toISOString(), endDate.toISOString()]
  );

  const hardDemandResult = await dbPool.query(
    `SELECT date_trunc('week', a.start_time) as week_start, COUNT(*)::int as cnt
     FROM appointments a
     WHERE a.pool = $1
       AND a.appointment_status IS NULL
       AND a.start_time >= $2
       AND a.start_time < $3
     GROUP BY week_start
     ORDER BY week_start`,
    [poolFilter, startOfWeek.toISOString(), endDate.toISOString()]
  );

  const softDemandResult = await dbPool.query(
    `SELECT date_trunc('week', si.window_start) as week_start, COUNT(*)::int as cnt
     FROM slot_intents si
     WHERE si.pool = $1
       AND si.state = 'open'
       AND si.window_start >= $2
       AND si.window_start < $3
     GROUP BY week_start
     ORDER BY week_start`,
    [poolFilter, startOfWeek.toISOString(), endDate.toISOString()]
  );

  const supplyByWeek = new Map<string, number>();
  for (const r of supplyResult.rows) {
    supplyByWeek.set(new Date(r.week_start).toISOString(), r.cnt);
  }
  const hardByWeek = new Map<string, number>();
  for (const r of hardDemandResult.rows) {
    hardByWeek.set(new Date(r.week_start).toISOString(), r.cnt);
  }
  const softByWeek = new Map<string, number>();
  for (const r of softDemandResult.rows) {
    softByWeek.set(new Date(r.week_start).toISOString(), r.cnt);
  }

  const weeks: WeekBucket[] = [];
  for (let i = 0; i < weeksAhead; i++) {
    const ws = new Date(startOfWeek);
    ws.setDate(ws.getDate() + i * 7);
    const key = ws.toISOString();
    const weekEnd = new Date(ws);
    weekEnd.setDate(weekEnd.getDate() + 6);

    weeks.push({
      weekStart: key,
      weekLabel: `${ws.getMonth() + 1}.${ws.getDate()} – ${weekEnd.getMonth() + 1}.${weekEnd.getDate()}`,
      supply: supplyByWeek.get(key) ?? 0,
      hardDemand: hardByWeek.get(key) ?? 0,
      softDemand: softByWeek.get(key) ?? 0,
    });
  }

  return NextResponse.json({
    pool: poolFilter,
    weeks,
    note: 'Kereslet a legkorábbi esedékesség hete alapján (window_start)',
  });
});
