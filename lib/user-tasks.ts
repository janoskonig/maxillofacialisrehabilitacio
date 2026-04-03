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
  createdAt: Date;
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
    createdAt: new Date(row.created_at as string),
  };
}

export async function insertUserTask(params: {
  assigneeKind: 'staff' | 'patient';
  assigneeUserId: string | null;
  assigneePatientId: string | null;
  patientId: string | null;
  taskType: 'document_upload' | 'ohip14' | 'manual' | 'meeting_action';
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
     ORDER BY due_at NULLS LAST, created_at DESC`,
    [userId]
  );
  return result.rows.map(mapRow);
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
