import { getDbPool } from '@/lib/db';
import { assertStaffCanAccessPatient } from '@/lib/staff-patient-access';

export type UserTaskRow = {
  id: string;
  assigneeKind: 'staff' | 'patient';
  assigneeUserId: string | null;
  assigneePatientId: string | null;
  patientId: string | null;
  taskType: string;
  status: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  sourceMessageId: string | null;
  sourceDoctorMessageId: string | null;
  createdByUserId: string;
  dueAt: Date | null;
  completedAt: Date | null;
  viewedAt: Date | null;
  createdAt: Date;
};

export type StaffOpenTaskSummary = {
  totalOpen: number;
  unviewed: number;
  viewedOpen: number;
};

function mapRow(row: Record<string, unknown>): UserTaskRow {
  return {
    id: row.id as string,
    assigneeKind: row.assignee_kind as 'staff' | 'patient',
    assigneeUserId: (row.assignee_user_id as string) ?? null,
    assigneePatientId: (row.assignee_patient_id as string) ?? null,
    patientId: (row.patient_id as string) ?? null,
    taskType: row.task_type as string,
    status: row.status as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) || {},
    sourceMessageId: (row.source_message_id as string) ?? null,
    sourceDoctorMessageId: (row.source_doctor_message_id as string) ?? null,
    createdByUserId: row.created_by_user_id as string,
    dueAt: row.due_at ? new Date(row.due_at as string) : null,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    viewedAt: row.viewed_at ? new Date(row.viewed_at as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}

export async function insertUserTask(params: {
  assigneeKind: 'staff' | 'patient';
  assigneeUserId: string | null;
  assigneePatientId: string | null;
  patientId: string | null;
  taskType:
    | 'document_upload'
    | 'ohip14'
    | 'manual'
    | 'meeting_action'
    | 'staff_registration_review';
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  sourceMessageId?: string | null;
  sourceDoctorMessageId?: string | null;
  createdByUserId: string;
  dueAt?: Date | null;
}): Promise<UserTaskRow> {
  const pool = getDbPool();
  const result = await pool.query(
    `INSERT INTO user_tasks (
      assignee_kind, assignee_user_id, assignee_patient_id, patient_id,
      task_type, status, title, description, metadata, source_message_id,
      source_doctor_message_id, created_by_user_id, due_at
    ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8::jsonb, $9, $10, $11, $12)
    RETURNING *`,
    [
      params.assigneeKind,
      params.assigneeUserId,
      params.assigneePatientId,
      params.patientId,
      params.taskType,
      params.title,
      params.description ?? null,
      JSON.stringify(params.metadata ?? {}),
      params.sourceMessageId ?? null,
      params.sourceDoctorMessageId ?? null,
      params.createdByUserId,
      params.dueAt ?? null,
    ]
  );
  return mapRow(result.rows[0]);
}

export async function listOpenTasksForStaff(userId: string): Promise<UserTaskRow[]> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT * FROM user_tasks
     WHERE assignee_kind = 'staff' AND assignee_user_id = $1 AND status = 'open'
     ORDER BY viewed_at NULLS FIRST, due_at NULLS LAST, created_at DESC`,
    [userId]
  );
  return result.rows.map(mapRow);
}

export async function getStaffOpenTaskSummary(userId: string): Promise<StaffOpenTaskSummary> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_open,
       COUNT(*) FILTER (WHERE viewed_at IS NULL)::int AS unviewed,
       COUNT(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed_open
     FROM user_tasks
     WHERE assignee_kind = 'staff' AND assignee_user_id = $1 AND status = 'open'`,
    [userId]
  );
  const row = result.rows[0] as { total_open: number; unviewed: number; viewed_open: number };
  return {
    totalOpen: row.total_open,
    unviewed: row.unviewed,
    viewedOpen: row.viewed_open,
  };
}

/** Marks all open staff tasks as seen (Feladataim list opened). */
export async function markOpenStaffTasksViewed(userId: string): Promise<number> {
  const pool = getDbPool();
  const result = await pool.query(
    `UPDATE user_tasks SET viewed_at = NOW()
     WHERE assignee_kind = 'staff' AND assignee_user_id = $1 AND status = 'open' AND viewed_at IS NULL`,
    [userId]
  );
  return result.rowCount ?? 0;
}

export async function listOpenTasksForPatient(patientId: string): Promise<UserTaskRow[]> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT * FROM user_tasks
     WHERE assignee_kind = 'patient' AND assignee_patient_id = $1 AND status = 'open'
     ORDER BY due_at NULLS LAST, created_at DESC`,
    [patientId]
  );
  return result.rows.map(mapRow);
}

/**
 * Mark document-upload tasks done when the linked request message is fulfilled.
 */
export async function completeDocumentTasksBySourceMessage(params: {
  sourceMessageId?: string | null;
  sourceDoctorMessageId?: string | null;
  patientSessionId?: string | null;
  staffUserId?: string | null;
  staffEmail?: string | null;
  staffRole?: string | null;
}): Promise<number> {
  const pool = getDbPool();
  const { sourceMessageId, sourceDoctorMessageId, patientSessionId, staffUserId, staffEmail, staffRole } = params;

  let tasks;
  if (sourceMessageId) {
    tasks = await pool.query(
      `SELECT * FROM user_tasks
       WHERE source_message_id = $1 AND status = 'open' AND task_type = 'document_upload'`,
      [sourceMessageId]
    );
  } else if (sourceDoctorMessageId) {
    tasks = await pool.query(
      `SELECT * FROM user_tasks
       WHERE source_doctor_message_id = $1 AND status = 'open' AND task_type = 'document_upload'`,
      [sourceDoctorMessageId]
    );
  } else {
    return 0;
  }

  let updated = 0;
  for (const row of tasks.rows) {
    const t = mapRow(row);
    let can = false;
    if (t.assigneeKind === 'patient' && patientSessionId && t.assigneePatientId === patientSessionId) {
      can = true;
    }
    if (t.assigneeKind === 'staff' && staffUserId && t.assigneeUserId === staffUserId) {
      can = true;
    }
    if (
      !can &&
      staffUserId &&
      staffEmail &&
      staffRole &&
      t.taskType === 'document_upload' &&
      t.assigneeKind === 'patient' &&
      t.patientId &&
      (await assertStaffCanAccessPatient(staffUserId, staffEmail, staffRole, t.patientId)).ok
    ) {
      can = true;
    }
    if (can) {
      await pool.query(
        `UPDATE user_tasks SET status = 'done', completed_at = NOW() WHERE id = $1 AND status = 'open'`,
        [t.id]
      );
      updated++;
    }
  }
  return updated;
}

export async function markTaskDoneForStaff(taskId: string, staffUserId: string): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(
    `UPDATE user_tasks SET status = 'done', completed_at = NOW()
     WHERE id = $1 AND assignee_kind = 'staff' AND assignee_user_id = $2 AND status = 'open'
     RETURNING id`,
    [taskId, staffUserId]
  );
  return result.rows.length > 0;
}

/**
 * Új munkatárs regisztrációs kérelméhez egy-egy nyitott feladatot hoz létre
 * minden aktív admin részére. A feladat metadata-jában tárolja a függő
 * felhasználó azonosítóját (`pendingUserId`), így később (jóváhagyáskor /
 * elutasításkor) az összes admin feladata egyszerre lezárható.
 *
 * Visszaadja a létrehozott feladatok számát.
 */
export async function createStaffRegistrationReviewTasks(params: {
  pendingUserId: string;
  pendingUserEmail: string;
  pendingUserName?: string | null;
  pendingUserRole?: string | null;
  pendingUserInstitution?: string | null;
  pendingUserAccessReason?: string | null;
}): Promise<number> {
  const pool = getDbPool();
  const adminsResult = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' AND active = true`
  );
  const admins: Array<{ id: string }> = adminsResult.rows;
  if (admins.length === 0) return 0;

  const title = 'Új regisztrációs kérelem jóváhagyása';
  const descriptionLines = [
    `Email: ${params.pendingUserEmail}`,
    params.pendingUserName ? `Név: ${params.pendingUserName}` : null,
    params.pendingUserRole ? `Szerepkör: ${params.pendingUserRole}` : null,
    params.pendingUserInstitution ? `Intézmény: ${params.pendingUserInstitution}` : null,
    params.pendingUserAccessReason
      ? `Indokolás: ${params.pendingUserAccessReason}`
      : null,
  ].filter((line): line is string => Boolean(line));
  const description = descriptionLines.join('\n');

  const metadata = {
    source: 'staff_registration',
    pendingUserId: params.pendingUserId,
    pendingUserEmail: params.pendingUserEmail,
    pendingUserName: params.pendingUserName ?? null,
    pendingUserRole: params.pendingUserRole ?? null,
    pendingUserInstitution: params.pendingUserInstitution ?? null,
  };

  let inserted = 0;
  for (const admin of admins) {
    await pool.query(
      `INSERT INTO user_tasks (
        assignee_kind, assignee_user_id, assignee_patient_id, patient_id,
        task_type, status, title, description, metadata, created_by_user_id
      ) VALUES ('staff', $1, NULL, NULL,
        'staff_registration_review', 'open', $2, $3, $4::jsonb, $5)`,
      [admin.id, title, description, JSON.stringify(metadata), params.pendingUserId]
    );
    inserted++;
  }
  return inserted;
}

/**
 * Lezárja a megadott függő felhasználóhoz tartozó nyitott
 * `staff_registration_review` feladatokat. `status`:
 *   - `done`      — admin jóváhagyta a regisztrációt
 *   - `cancelled` — admin elutasította / inaktiválta a felhasználót
 *
 * Visszaadja a frissített sorok számát.
 */
export async function closeStaffRegistrationReviewTasks(
  pendingUserId: string,
  status: 'done' | 'cancelled'
): Promise<number> {
  const pool = getDbPool();
  const result = await pool.query(
    `UPDATE user_tasks
       SET status = $2, completed_at = NOW()
     WHERE task_type = 'staff_registration_review'
       AND status = 'open'
       AND metadata->>'pendingUserId' = $1`,
    [pendingUserId, status]
  );
  return result.rowCount ?? 0;
}

/**
 * Véglegesen törli a megadott függő felhasználóhoz tartozó összes
 * `staff_registration_review` feladatot (státusztól függetlenül).
 *
 * Akkor használjuk, amikor a függő `users` sort is ténylegesen DELETE-eljük
 * (regisztráció elutasítása). Erre azért van szükség, mert a
 * `user_tasks.created_by_user_id` FK ugyan `ON DELETE SET NULL`, de a
 * column `NOT NULL`, így a kaszkád törlés egyébként hibára futna.
 */
export async function deleteStaffRegistrationReviewTasks(
  pendingUserId: string
): Promise<number> {
  const pool = getDbPool();
  const result = await pool.query(
    `DELETE FROM user_tasks
     WHERE task_type = 'staff_registration_review'
       AND (
         metadata->>'pendingUserId' = $1
         OR created_by_user_id = $1::uuid
       )`,
    [pendingUserId]
  );
  return result.rowCount ?? 0;
}

/**
 * Konzílium delegált feladat visszavonása (listáról eltűnik a nyitottak közül; a történet megmarad cancelled státusszal).
 * Csak a címzett, a létrehozó vagy admin vonhatja vissza; ugyanahhoz az intézményhez tartozó aktív felhasználó kell.
 */
export async function cancelConsiliumMeetingTaskForUser(
  taskId: string,
  actorUserId: string,
  actorRole: string,
  institutionId: string,
): Promise<boolean> {
  if (actorRole === 'technikus') return false;
  const pool = getDbPool();
  const result = await pool.query(
    `UPDATE user_tasks t
     SET status = 'cancelled', completed_at = COALESCE(t.completed_at, NOW())
     FROM users u
     WHERE t.id = $1::uuid
       AND t.task_type = 'meeting_action'
       AND COALESCE(t.metadata->>'source', '') = 'consilium_checklist'
       AND t.status = 'open'
       AND u.id = $2::uuid
       AND u.active = true
       AND btrim(coalesce(u.intezmeny, '')) = btrim(coalesce($3::text, ''))
       AND (
         t.assignee_user_id = u.id
         OR t.created_by_user_id = u.id
         OR ($4::text = 'admin')
       )
     RETURNING t.id`,
    [taskId, actorUserId, institutionId, actorRole],
  );
  return result.rows.length > 0;
}
