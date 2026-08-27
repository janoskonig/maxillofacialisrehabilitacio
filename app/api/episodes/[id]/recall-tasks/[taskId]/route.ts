import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/** Külső kontroll kézi teljesítése, illetve téves teljesítés visszanyitása. */
export const PATCH = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const taskId = params.taskId;
  const body = await req.json();
  const action = body.action as string;
  if (action !== 'complete' && action !== 'reopen') {
    return NextResponse.json({ error: 'action csak complete vagy reopen lehet' }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskResult = await client.query(
      `SELECT et.id, et.completed_at, et.appointment_id, pe.status AS episode_status
         FROM episode_tasks et
         JOIN patient_episodes pe ON pe.id = et.episode_id
        WHERE et.id = $1 AND et.episode_id = $2
          AND et.task_type = 'recall_due'
          AND et.recall_interval_days IS NOT NULL
        FOR UPDATE OF et`,
      [taskId, episodeId],
    );
    if (taskResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Recall-feladat nem található' }, { status: 404 });
    }
    if (taskResult.rows[0].episode_status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Lezárt epizód recall-feladata nem módosítható' }, { status: 409 });
    }
    if (taskResult.rows[0].appointment_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Időponthoz kapcsolt recallt az időpont státuszával kell módosítani' },
        { status: 409 },
      );
    }

    if (action === 'complete') {
      await client.query(
        `UPDATE episode_tasks SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) WHERE id = $1`,
        [taskId],
      );
    } else {
      await client.query(
        `UPDATE episode_tasks SET completed_at = NULL WHERE id = $1`,
        [taskId],
      );
    }
    await client.query('COMMIT');

    await logActivity(
      req,
      auth.email ?? auth.userId ?? 'unknown',
      action === 'complete' ? 'recall_task_completed_manually' : 'recall_task_reopened',
      JSON.stringify({ episodeId, taskId }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

/**
 * Recall-sor törlése (WP-3.3) — tipikusan a rizikószint-váltás után
 * feleslegessé vált auto sorokra, a UI „Törlés" ajánlatából. A törlés mindig
 * kifejezett felhasználói döntés: a szolgáltatásréteg magától soha nem töröl.
 * Foglalt vagy teljesített sort nem töröl (409) — a foglalást előbb le kell
 * mondani, a teljesítés pedig előzmény.
 */
export const DELETE = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const taskId = params.taskId;
  const pool = getDbPool();

  const taskResult = await pool.query(
    `SELECT et.id, et.completed_at, et.appointment_id, et.source, et.label,
            et.recall_interval_days, pe.status AS episode_status
       FROM episode_tasks et
       JOIN patient_episodes pe ON pe.id = et.episode_id
      WHERE et.id = $1 AND et.episode_id = $2
        AND et.task_type = 'recall_due'
        AND et.recall_interval_days IS NOT NULL`,
    [taskId, episodeId],
  );
  if (taskResult.rows.length === 0) {
    return NextResponse.json({ error: 'Recall-feladat nem található' }, { status: 404 });
  }
  const task = taskResult.rows[0];
  if (task.episode_status !== 'open') {
    return NextResponse.json({ error: 'Lezárt epizód recall-feladata nem módosítható' }, { status: 409 });
  }
  if (task.appointment_id) {
    return NextResponse.json(
      { error: 'Foglalt visszarendelés nem törölhető — előbb az időpontot kell lemondani' },
      { status: 409 },
    );
  }
  if (task.completed_at) {
    return NextResponse.json(
      { error: 'Teljesített visszarendelés előzmény, nem törölhető' },
      { status: 409 },
    );
  }

  await pool.query(`DELETE FROM episode_tasks WHERE id = $1`, [taskId]);

  await logActivity(
    req,
    auth.email ?? auth.userId ?? 'unknown',
    'recall_task_deleted',
    JSON.stringify({
      episodeId,
      taskId,
      source: task.source,
      intervalDays: task.recall_interval_days,
      label: task.label,
    }),
  );
  return NextResponse.json({ ok: true });
});
