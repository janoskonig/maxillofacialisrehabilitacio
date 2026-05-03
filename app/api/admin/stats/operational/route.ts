/**
 * GET /api/admin/stats/operational
 *
 * Operatív / SLA-jellegű KPI-ok (jelenleg csak user_tasks).
 *
 * Mit ad vissza:
 *   - `userTasks.osszesito` — összes / nyitott / kész / törölt feladat.
 *   - `userTasks.tipusSzerint` — task_type × status mátrix + medián
 *                                 megoldási idő (ahol már `done`).
 *   - `userTasks.assigneeKindSzerint` — staff vs patient delegálás bontás.
 *   - `userTasks.lejarat` — nyitott + lejárt (`due_at < NOW`) feladatok
 *                            száma + a legrégebben nyitott napok száma.
 *
 * Csak admin szerepkörnek; a user_tasks tábla hiányát 503-mal jelzi.
 */

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin'], async () => {
  const pool = getDbPool();

  const probe = await pool.query<{ has_table: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'user_tasks'
    ) AS has_table
  `);
  if (!probe.rows[0]?.has_table) {
    return NextResponse.json(
      {
        error:
          'A user_tasks tábla nem található ezen az adatbázison — az operatív SLA statisztika csak a 014-es migráció után érhető el.',
        code: 'USER_TASKS_TABLE_MISSING',
      },
      { status: 503 }
    );
  }

  const [
    summaryResult,
    byTypeResult,
    byAssigneeKindResult,
    overdueResult,
  ] = await Promise.all([
    pool.query<{
      osszes: string;
      nyitott: string;
      kesz: string;
      torolt: string;
      lejart: string;
      median_megoldasi_napok: string | null;
    }>(`
      SELECT
        COUNT(*)::int AS osszes,
        COUNT(*) FILTER (WHERE status = 'open')::int AS nyitott,
        COUNT(*) FILTER (WHERE status = 'done')::int AS kesz,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS torolt,
        COUNT(*) FILTER (WHERE status = 'open' AND due_at IS NOT NULL AND due_at < NOW())::int AS lejart,
        ROUND((
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400.0
          )
          FILTER (WHERE status = 'done' AND completed_at IS NOT NULL)
        )::numeric, 1) AS median_megoldasi_napok
      FROM user_tasks
    `),
    pool.query<{
      task_type: string;
      osszes: string;
      nyitott: string;
      kesz: string;
      torolt: string;
      median_megoldasi_napok: string | null;
    }>(`
      SELECT
        task_type,
        COUNT(*)::int AS osszes,
        COUNT(*) FILTER (WHERE status = 'open')::int AS nyitott,
        COUNT(*) FILTER (WHERE status = 'done')::int AS kesz,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS torolt,
        ROUND((
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400.0
          )
          FILTER (WHERE status = 'done' AND completed_at IS NOT NULL)
        )::numeric, 1) AS median_megoldasi_napok
      FROM user_tasks
      GROUP BY task_type
      ORDER BY osszes DESC
    `),
    pool.query<{
      assignee_kind: string;
      osszes: string;
      nyitott: string;
    }>(`
      SELECT
        assignee_kind,
        COUNT(*)::int AS osszes,
        COUNT(*) FILTER (WHERE status = 'open')::int AS nyitott
      FROM user_tasks
      GROUP BY assignee_kind
      ORDER BY osszes DESC
    `),
    pool.query<{
      legregebben_napok: string | null;
      lejart_atlag_napok: string | null;
    }>(`
      WITH open_tasks AS (
        SELECT
          EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0 AS kor_napok,
          due_at
        FROM user_tasks
        WHERE status = 'open'
      )
      SELECT
        ROUND(MAX(kor_napok)::numeric, 0) AS legregebben_napok,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - due_at)) / 86400.0)
              FILTER (WHERE due_at IS NOT NULL AND due_at < NOW())::numeric, 1)
          AS lejart_atlag_napok
      FROM open_tasks
    `),
  ]);

  const numOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const intOrZero = (v: unknown): number => {
    if (v == null) return 0;
    const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const summary = summaryResult.rows[0] ?? {};
  const overdue = overdueResult.rows[0] ?? {};

  return NextResponse.json({
    generaltAt: new Date().toISOString(),
    userTasks: {
      osszesito: {
        osszes: intOrZero(summary.osszes),
        nyitott: intOrZero(summary.nyitott),
        kesz: intOrZero(summary.kesz),
        torolt: intOrZero(summary.torolt),
        lejart: intOrZero(summary.lejart),
        medianMegoldasiNapok: numOrNull(summary.median_megoldasi_napok),
      },
      tipusSzerint: byTypeResult.rows.map((r) => ({
        taskType: r.task_type,
        osszes: intOrZero(r.osszes),
        nyitott: intOrZero(r.nyitott),
        kesz: intOrZero(r.kesz),
        torolt: intOrZero(r.torolt),
        medianMegoldasiNapok: numOrNull(r.median_megoldasi_napok),
      })),
      assigneeKindSzerint: byAssigneeKindResult.rows.map((r) => ({
        assigneeKind: r.assignee_kind,
        osszes: intOrZero(r.osszes),
        nyitott: intOrZero(r.nyitott),
      })),
      lejarat: {
        legregebbenNyitvaNapok: numOrNull(overdue.legregebben_napok),
        lejartAtlagNapok: numOrNull(overdue.lejart_atlag_napok),
      },
    },
  });
});
