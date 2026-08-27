import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { ensureRecallTasksForEpisode, recallDueAt } from '@/lib/recall-tasks';
import { recallLabelForInterval } from '@/lib/recall-cadence';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Az epizód recall-feladatai (auto + kézi, tetszőleges intervallum) és a
 * kapcsolt időpontjaik, esedékesség szerint.
 */
export const GET = roleHandler([...ROLES], async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  // Régi félbemaradt / hiányzó auto sorokat olvasáskor is önjavítjuk, és a
  // horgony-eltolódást (újabb teljesült kontroll) is itt húzzuk utána.
  await ensureRecallTasksForEpisode(episodeId, pool);

  // A korábban lemondott / sikertelen időpont ne tartsa foglaltnak a
  // feladatot akkor sem, ha egy régi kódút nem futtatta le a lifecycle-hookot.
  await pool.query(
    `UPDATE episode_tasks et
        SET appointment_id = NULL, completed_at = NULL
       FROM appointments a
      WHERE et.episode_id = $1
        AND et.task_type = 'recall_due'
        AND et.appointment_id = a.id
        AND a.appointment_status IN (
          'cancelled_by_doctor', 'cancelled_by_patient', 'no_show', 'unsuccessful'
        )`,
    [episodeId],
  );

  const result = await pool.query(
    `SELECT et.id,
            et.episode_id AS "episodeId",
            et.recall_interval_days AS "intervalDays",
            et.due_at AS "dueAt",
            et.completed_at AS "completedAt",
            et.source,
            et.label,
            et.created_by AS "createdBy",
            et.appointment_id AS "appointmentId",
            a.start_time AS "appointmentStart",
            a.appointment_status AS "appointmentStatus",
            a.appointment_type AS "appointmentType",
            a.dentist_email AS "dentistEmail"
       FROM episode_tasks et
       LEFT JOIN appointments a ON a.id = et.appointment_id
      WHERE et.episode_id = $1
        AND et.task_type = 'recall_due'
        AND et.recall_interval_days IS NOT NULL
      ORDER BY et.due_at, et.recall_interval_days`,
    [episodeId],
  );

  return NextResponse.json({ recallTasks: result.rows });
});

/**
 * Kézi visszarendelés felvétele tetszőleges pozitív nappal és címkével
 * (source='manual'). A kézi sorokat az auto-generálás soha nem írja felül
 * és nem duplikálja.
 *
 * Body: { intervalDays: number; label?: string }
 * A határidő horgonya a felvétel pillanata — az orvos tipikusan a vizit után
 * veszi fel („két hét múlva jöjjön vissza").
 */
export const POST = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const rawDays = (body as { intervalDays?: unknown; days?: unknown }).intervalDays
    ?? (body as { days?: unknown }).days;
  const intervalDays = Number(rawDays);
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
    return NextResponse.json(
      { error: 'intervalDays: pozitív egész napszám szükséges' },
      { status: 400 },
    );
  }

  const rawLabel = (body as { label?: unknown }).label;
  let label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
  if (!label) label = recallLabelForInterval(intervalDays);
  if (label.length > 200) {
    return NextResponse.json(
      { error: 'A címke legfeljebb 200 karakter lehet' },
      { status: 400 },
    );
  }

  const pool = getDbPool();
  const episodeResult = await pool.query(
    `SELECT pe.id, pe.status, p.halal_datum
       FROM patient_episodes pe
       JOIN patients p ON p.id = pe.patient_id
      WHERE pe.id = $1`,
    [episodeId],
  );
  if (episodeResult.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (episodeResult.rows[0].halal_datum) {
    return NextResponse.json(
      { error: 'Elhunyt beteg epizódjára nem vehető fel visszarendelés' },
      { status: 409 },
    );
  }
  if (episodeResult.rows[0].status !== 'open') {
    return NextResponse.json(
      { error: 'Lezárt epizódra nem vehető fel visszarendelés' },
      { status: 409 },
    );
  }

  const createdBy = auth.userId && UUID_RE.test(auth.userId) ? auth.userId : null;
  const dueAt = recallDueAt(new Date(), intervalDays);

  const inserted = await pool.query(
    `INSERT INTO episode_tasks
       (episode_id, task_type, due_at, recall_interval_days, source, label, created_by)
     VALUES ($1, 'recall_due', $2, $3, 'manual', $4, $5)
     RETURNING id,
               episode_id AS "episodeId",
               recall_interval_days AS "intervalDays",
               due_at AS "dueAt",
               completed_at AS "completedAt",
               source,
               label,
               created_by AS "createdBy",
               appointment_id AS "appointmentId"`,
    [episodeId, dueAt, intervalDays, label, createdBy],
  );

  await logActivity(
    req,
    auth.email ?? auth.userId ?? 'unknown',
    'recall_task_created_manually',
    JSON.stringify({ episodeId, taskId: inserted.rows[0].id, intervalDays, label }),
  );

  return NextResponse.json({ recallTask: inserted.rows[0] }, { status: 201 });
});
