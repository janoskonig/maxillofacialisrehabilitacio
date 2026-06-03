import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { sendPushNotification } from '@/lib/push-notifications';
import { sendTaskReminderEmail } from '@/lib/email';
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
  assignee_email: string | null;
  assignee_name: string | null;
  patient_name: string | null;
  want_push: boolean;
  want_email: boolean;
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

  // Nyitott, emlékeztetést kérő kézi feladatok (push és/vagy email), amiknek a
  // határideje az ablakon belül van (lejártakat is beleértve), és az adott
  // csatornán még nem emlékeztettünk rájuk.
  const { rows } = await pool.query<ReminderTaskRow>(
    `SELECT t.id, t.assignee_user_id, t.patient_id, t.title, t.due_at,
            u.email AS assignee_email, u.doktor_neve AS assignee_name,
            p.nev AS patient_name,
            (t.metadata->>'remind' = 'true'
              AND COALESCE(t.metadata->>'reminded', 'false') <> 'true') AS want_push,
            (t.metadata->>'remindEmail' = 'true'
              AND COALESCE(t.metadata->>'remindedEmail', 'false') <> 'true') AS want_email
       FROM user_tasks t
       JOIN users u ON u.id = t.assignee_user_id
       LEFT JOIN patients p ON p.id = t.patient_id
      WHERE t.assignee_kind = 'staff'
        AND t.assignee_user_id IS NOT NULL
        AND t.status = 'open'
        AND t.task_type = 'manual'
        AND (
          (t.metadata->>'remind' = 'true' AND COALESCE(t.metadata->>'reminded', 'false') <> 'true')
          OR (t.metadata->>'remindEmail' = 'true' AND COALESCE(t.metadata->>'remindedEmail', 'false') <> 'true')
        )
        AND t.due_at IS NOT NULL
        AND t.due_at <= NOW() + ($1 || ' hours')::interval
      ORDER BY t.due_at ASC`,
    [String(hoursAhead)]
  );

  logger.info(
    `[task-reminders][${correlationId}] ${rows.length} esedékes emlékeztető (ablak: ${hoursAhead}h)`
  );

  let pushSent = 0;
  let emailSent = 0;
  let failed = 0;

  /** Beállítja a megadott "reminded" kulcsot, hogy ne ismételjük az adott csatornát. */
  const markReminded = (taskId: string, key: 'reminded' | 'remindedEmail') =>
    pool.query(
      `UPDATE user_tasks
          SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), $2::text[], 'true'::jsonb, true)
        WHERE id = $1`,
      [taskId, `{${key}}`]
    );

  for (const task of rows) {
    const due = new Date(task.due_at);
    const overdue = due.getTime() < Date.now();
    const dueLabel = due.toLocaleString('hu-HU', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    if (task.want_push) {
      try {
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
        await markReminded(task.id, 'reminded');
        pushSent++;
      } catch (error) {
        failed++;
        logger.error(
          `[task-reminders][${correlationId}] Push hiba a(z) ${task.id} feladatnál:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (task.want_email && task.assignee_email) {
      try {
        await sendTaskReminderEmail({
          to: task.assignee_email,
          assigneeName: task.assignee_name,
          title: task.title,
          dueAt: due,
          overdue,
          patientName: task.patient_name,
          taskId: task.id,
        });
        await markReminded(task.id, 'remindedEmail');
        emailSent++;
      } catch (error) {
        failed++;
        logger.error(
          `[task-reminders][${correlationId}] Email hiba a(z) ${task.id} feladatnál:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  const duration = Date.now() - startTime;
  logger.info(
    `[task-reminders][${correlationId}] Kész ${duration}ms alatt: ${pushSent} push, ${emailSent} email, ${failed} hiba`
  );

  return NextResponse.json(
    {
      success: failed === 0,
      timestamp: new Date().toISOString(),
      hoursAhead,
      eligible: rows.length,
      pushSent,
      emailSent,
      failed,
      duration,
    },
    { status: failed === 0 ? 200 : 207 }
  );
});
