import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/** Alapértelmezett előretekintés órákban — ennyivel a határidő előtt szól. */
const DEFAULT_HOURS_AHEAD = 24;

type ReminderTaskRow = {
  id: string;
  assignee_user_id: string;
  patient_id: string | null;
  title: string;
  due_at: string;
};

/**
 * GET /api/tasks/reminders/cron
 *
 * Külső ütemező (óránként) hívja `x-api-key`-jel. A nyitott, `remind=true`
 * jelölésű kézi feladatokra push-emlékeztetőt küld a felelősnek, ha a határidő
 * az előretekintési ablakon belülre került (vagy már lejárt), és még nem
 * emlékeztettünk rá. Az ismétlést a `metadata.reminded=true` jelzés akadályozza.
 *
 * Paraméterek (opcionális query): `hoursAhead` — előretekintés órákban (1–168).
 */
export const GET = apiHandler(async (req, { correlationId }) => {
  const startTime = Date.now();

  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.TASK_REMINDERS_API_KEY;

  if (!expectedApiKey) {
    logger.error(`[task-reminders][${correlationId}] TASK_REMINDERS_API_KEY nincs beállítva`);
    return NextResponse.json({ error: 'Reminder cron is not configured' }, { status: 503 });
  }
  if (apiKey !== expectedApiKey) {
    logger.warn(`[task-reminders][${correlationId}] Jogosulatlan cron hívás`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawHours = Number(req.nextUrl.searchParams.get('hoursAhead'));
  const hoursAhead =
    Number.isFinite(rawHours) && rawHours >= 1 && rawHours <= 168
      ? Math.floor(rawHours)
      : DEFAULT_HOURS_AHEAD;

  const pool = getDbPool();

  // Nyitott, emlékeztetést kérő kézi feladatok, amiknek a határideje az ablakon
  // belül van (lejártakat is beleértve), és még nem emlékeztettünk rájuk.
  const { rows } = await pool.query<ReminderTaskRow>(
    `SELECT id, assignee_user_id, patient_id, title, due_at
       FROM user_tasks
      WHERE assignee_kind = 'staff'
        AND assignee_user_id IS NOT NULL
        AND status = 'open'
        AND task_type = 'manual'
        AND metadata->>'remind' = 'true'
        AND COALESCE(metadata->>'reminded', 'false') <> 'true'
        AND due_at IS NOT NULL
        AND due_at <= NOW() + ($1 || ' hours')::interval
      ORDER BY due_at ASC`,
    [String(hoursAhead)]
  );

  logger.info(
    `[task-reminders][${correlationId}] ${rows.length} esedékes emlékeztető (ablak: ${hoursAhead}h)`
  );

  let sent = 0;
  let failed = 0;

  for (const task of rows) {
    try {
      const due = new Date(task.due_at);
      const overdue = due.getTime() < Date.now();
      const dueLabel = due.toLocaleString('hu-HU', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      await sendPushNotification(task.assignee_user_id, {
        title: overdue ? 'Lejárt teendő' : 'Közelgő teendő határidő',
        body: overdue
          ? `„${task.title}" határideje lejárt (${dueLabel}).`
          : `„${task.title}" — határidő: ${dueLabel}.`,
        tag: `task-reminder-${task.id}`,
        requireInteraction: overdue,
        data: {
          type: 'reminder',
          id: task.id,
          url: task.patient_id ? `/patients/${task.patient_id}/view` : '/tasks',
        },
      });

      // Egyszeri jelzés: ne emlékeztessünk újra ugyanarra a feladatra.
      await pool.query(
        `UPDATE user_tasks
            SET metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{reminded}',
              'true'::jsonb,
              true
            )
          WHERE id = $1`,
        [task.id]
      );
      sent++;
    } catch (error) {
      failed++;
      logger.error(
        `[task-reminders][${correlationId}] Hiba a(z) ${task.id} feladat emlékeztetőjénél:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const duration = Date.now() - startTime;
  logger.info(
    `[task-reminders][${correlationId}] Kész ${duration}ms alatt: ${sent} elküldve, ${failed} hiba`
  );

  return NextResponse.json(
    {
      success: failed === 0,
      timestamp: new Date().toISOString(),
      hoursAhead,
      eligible: rows.length,
      sent,
      failed,
      duration,
    },
    { status: failed === 0 ? 200 : 207 }
  );
});
