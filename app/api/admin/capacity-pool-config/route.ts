import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin'], async (req, { auth }) => {
  const pool = getDbPool();

  const configResult = await pool.query(
    `SELECT week_start as "weekStart",
            consult_min as "consultMin",
            consult_target as "consultTarget",
            work_target as "workTarget",
            control_target as "controlTarget",
            flex_target as "flexTarget",
            created_at as "createdAt"
     FROM capacity_pool_config
     WHERE week_start >= (CURRENT_DATE - INTERVAL '7 days')::date
     ORDER BY week_start ASC`
  );

  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const weekStr = weekStart.toISOString().slice(0, 10);

  const freezeHorizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const horizonEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const distributionResult = await pool.query(
    `SELECT COALESCE(slot_purpose, 'flexible') as purpose, COUNT(*)::int as count
     FROM available_time_slots
     WHERE state = 'free' AND start_time >= $1 AND start_time <= $2
     GROUP BY slot_purpose`,
    [freezeHorizon, horizonEnd]
  );

  const distribution: Record<string, number> = { consult: 0, work: 0, control: 0, flexible: 0 };
  for (const row of distributionResult.rows) {
    distribution[row.purpose] = row.count;
  }

  return NextResponse.json({
    configs: configResult.rows,
    currentWeekStart: weekStr,
    currentDistribution: distribution,
  });
});

export const PUT = roleHandler(['admin'], async (req, { auth }) => {
  const pool = getDbPool();
  const body = await req.json();
  const { weekStart, consultMin, consultTarget, workTarget, controlTarget, flexTarget } = body;

  if (!weekStart) {
    return NextResponse.json({ error: 'weekStart kötelező' }, { status: 400 });
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(weekStart)) {
    return NextResponse.json({ error: 'weekStart formátuma: YYYY-MM-DD' }, { status: 400 });
  }

  const fields: Record<string, number | undefined> = { consultMin, consultTarget, workTarget, controlTarget, flexTarget };
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && (typeof val !== 'number' || val < 0)) {
      return NextResponse.json({ error: `${key} nem-negatív szám kell legyen` }, { status: 400 });
    }
  }

  const result = await pool.query(
    `INSERT INTO capacity_pool_config (week_start, consult_min, consult_target, work_target, control_target, flex_target)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (week_start) DO UPDATE SET
       consult_min = COALESCE($2, capacity_pool_config.consult_min),
       consult_target = COALESCE($3, capacity_pool_config.consult_target),
       work_target = COALESCE($4, capacity_pool_config.work_target),
       control_target = COALESCE($5, capacity_pool_config.control_target),
       flex_target = COALESCE($6, capacity_pool_config.flex_target)
     RETURNING
       week_start as "weekStart",
       consult_min as "consultMin",
       consult_target as "consultTarget",
       work_target as "workTarget",
       control_target as "controlTarget",
       flex_target as "flexTarget"`,
    [weekStart, consultMin ?? 2, consultTarget ?? 4, workTarget ?? 20, controlTarget ?? 6, flexTarget ?? 0]
  );

  return NextResponse.json({ config: result.rows[0] });
});
