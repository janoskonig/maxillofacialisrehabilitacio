import type { PoolClient } from 'pg';

export interface RecallTaskBookingCheck {
  ok: boolean;
  error?: string;
  code?: string;
  status?: number;
}

const RELEASE_STATUSES = new Set([
  'cancelled_by_doctor',
  'cancelled_by_patient',
  'no_show',
  'unsuccessful',
]);

/** Zárolás + scope/lifecycle ellenőrzés az időpont-foglalás tranzakciójában. */
export async function validateRecallTaskForBooking(
  client: Pick<PoolClient, 'query'>,
  input: { taskId: string; patientId: string; episodeId: string | null },
): Promise<RecallTaskBookingCheck> {
  if (!input.episodeId) {
    return { ok: false, error: 'Recall foglaláshoz epizód szükséges', code: 'RECALL_EPISODE_REQUIRED', status: 400 };
  }

  const result = await client.query(
    `SELECT et.id, et.episode_id, et.completed_at, et.appointment_id,
            pe.patient_id, pe.status AS episode_status,
            a.appointment_status
       FROM episode_tasks et
       JOIN patient_episodes pe ON pe.id = et.episode_id
       LEFT JOIN appointments a ON a.id = et.appointment_id
      WHERE et.id = $1
        AND et.task_type = 'recall_due'
        AND et.recall_interval_days IN (180, 365)
      FOR UPDATE OF et`,
    [input.taskId],
  );

  if (result.rows.length === 0) {
    return { ok: false, error: 'Recall-feladat nem található', code: 'RECALL_TASK_NOT_FOUND', status: 404 };
  }
  const task = result.rows[0];
  if (task.patient_id !== input.patientId || task.episode_id !== input.episodeId) {
    return { ok: false, error: 'A recall-feladat nem ehhez a beteghez vagy epizódhoz tartozik', code: 'RECALL_TASK_SCOPE_MISMATCH', status: 400 };
  }
  if (task.episode_status !== 'open') {
    return { ok: false, error: 'Lezárt epizód recall-feladata nem foglalható', code: 'RECALL_EPISODE_CLOSED', status: 409 };
  }
  if (task.completed_at) {
    return { ok: false, error: 'A recall-feladat már teljesítve van', code: 'RECALL_TASK_COMPLETED', status: 409 };
  }

  if (task.appointment_id) {
    if (!RELEASE_STATUSES.has(task.appointment_status)) {
      return { ok: false, error: 'Ehhez a recall-feladathoz már tartozik aktív időpont', code: 'RECALL_TASK_ALREADY_BOOKED', status: 409 };
    }
    await client.query(`UPDATE episode_tasks SET appointment_id = NULL WHERE id = $1`, [input.taskId]);
  }

  return { ok: true };
}

export async function linkRecallTaskToAppointment(
  client: Pick<PoolClient, 'query'>,
  taskId: string,
  appointmentId: string,
): Promise<void> {
  await client.query(
    `UPDATE episode_tasks
        SET appointment_id = $2, completed_at = NULL
      WHERE id = $1 AND task_type = 'recall_due'`,
    [taskId, appointmentId],
  );
}

/** Időpontstátusz-váltás → recall-feladat lifecycle. */
export async function syncRecallTaskForAppointmentStatus(
  client: Pick<PoolClient, 'query'>,
  input: { appointmentId: string; oldStatus: string | null; newStatus: string | null },
): Promise<void> {
  if (input.newStatus === 'completed') {
    await client.query(
      `UPDATE episode_tasks
          SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
        WHERE appointment_id = $1 AND task_type = 'recall_due'`,
      [input.appointmentId],
    );
    return;
  }

  if (input.newStatus && RELEASE_STATUSES.has(input.newStatus)) {
    await client.query(
      `UPDATE episode_tasks
          SET appointment_id = NULL, completed_at = NULL
        WHERE appointment_id = $1 AND task_type = 'recall_due'`,
      [input.appointmentId],
    );
    return;
  }

  if (input.oldStatus === 'completed') {
    await client.query(
      `UPDATE episode_tasks
          SET completed_at = NULL
        WHERE appointment_id = $1 AND task_type = 'recall_due'`,
      [input.appointmentId],
    );
  }
}
