import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { ensureRecallTasksForEpisode } from '@/lib/recall-tasks';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/** Az epizód kanonikus 6/12 hónapos recall-feladatai és kapcsolt időpontjai. */
export const GET = roleHandler([...ROLES], async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  // Régi félbemaradt párt olvasáskor is önjavítjuk.
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
            et.appointment_id AS "appointmentId",
            a.start_time AS "appointmentStart",
            a.appointment_status AS "appointmentStatus",
            a.appointment_type AS "appointmentType",
            a.dentist_email AS "dentistEmail"
       FROM episode_tasks et
       LEFT JOIN appointments a ON a.id = et.appointment_id
      WHERE et.episode_id = $1
        AND et.task_type = 'recall_due'
        AND et.recall_interval_days IN (180, 365)
      ORDER BY et.recall_interval_days`,
    [episodeId],
  );

  return NextResponse.json({ recallTasks: result.rows });
});
