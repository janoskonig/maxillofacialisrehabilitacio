import { getDbPool } from '@/lib/db';

export type TaskOverviewStatus = 'open' | 'done' | 'all';

export type TaskOverviewRow = {
  id: string;
  taskType: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  overdue: boolean;
  assigneeUserId: string;
  assigneeName: string | null;
  assigneeEmail: string;
  assigneeInstitution: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  patientId: string | null;
  patientName: string | null;
};

export type TaskOverviewAssigneeSummary = {
  userId: string;
  name: string | null;
  email: string;
  open: number;
  overdue: number;
};

export type TaskOverview = {
  tasks: TaskOverviewRow[];
  summary: {
    totalOpen: number;
    overdue: number;
    dueSoon: number;
    byAssignee: TaskOverviewAssigneeSummary[];
  };
};

/**
 * Vezetői feladat-áttekintés. Admin minden intézményt lát; egyéb vezetők
 * (fogpótlástanász, beutaló orvos) csak a saját intézményük munkatársainak
 * feladatait (a címzett intézménye alapján).
 *
 * `status`:
 *   - `open` — csak nyitott feladatok (alap)
 *   - `done` — az elmúlt 30 napban lezárt feladatok
 *   - `all`  — nyitott + elmúlt 30 napban lezárt
 */
export async function getStaffTaskOverview(params: {
  actorRole: string;
  institutionId: string;
  status?: TaskOverviewStatus;
}): Promise<TaskOverview> {
  const pool = getDbPool();
  const status: TaskOverviewStatus = params.status ?? 'open';

  const where: string[] = [`t.assignee_kind = 'staff'`];
  const values: unknown[] = [];

  if (status === 'open') {
    where.push(`t.status = 'open'`);
  } else if (status === 'done') {
    where.push(`t.status = 'done' AND t.completed_at > NOW() - INTERVAL '30 days'`);
  } else {
    where.push(
      `(t.status = 'open' OR (t.status = 'done' AND t.completed_at > NOW() - INTERVAL '30 days'))`,
    );
  }

  // Intézményi hatókör: admin mindent lát, egyébként a címzett intézménye szerint szűrünk.
  if (params.actorRole !== 'admin') {
    values.push(params.institutionId);
    where.push(`btrim(coalesce(au.intezmeny, '')) = btrim(coalesce($${values.length}::text, ''))`);
  }

  const result = await pool.query(
    `SELECT t.id, t.task_type, t.title, t.description, t.status,
            t.due_at, t.created_at, t.completed_at,
            t.assignee_user_id,
            au.doktor_neve AS assignee_name, au.email AS assignee_email,
            au.intezmeny AS assignee_institution,
            cu.doktor_neve AS creator_name, cu.email AS creator_email,
            t.patient_id, p.nev AS patient_name
     FROM user_tasks t
     JOIN users au ON au.id = t.assignee_user_id
     LEFT JOIN users cu ON cu.id = t.created_by_user_id
     LEFT JOIN patients p ON p.id = t.patient_id
     WHERE ${where.join(' AND ')}
     ORDER BY (t.status = 'open') DESC,
              (t.due_at IS NOT NULL AND t.due_at < NOW() AND t.status = 'open') DESC,
              t.due_at ASC NULLS LAST,
              t.created_at DESC`,
    values,
  );

  const now = Date.now();
  const soonCutoff = now + 7 * 24 * 60 * 60 * 1000;

  const tasks: TaskOverviewRow[] = result.rows.map((row) => {
    const dueAt = row.due_at ? new Date(row.due_at as string).toISOString() : null;
    const isOpen = row.status === 'open';
    const overdue = isOpen && !!dueAt && new Date(dueAt).getTime() < now;
    return {
      id: row.id as string,
      taskType: row.task_type as string,
      title: row.title as string,
      description: (row.description as string) ?? null,
      status: row.status as string,
      dueAt,
      createdAt: new Date(row.created_at as string).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
      overdue,
      assigneeUserId: row.assignee_user_id as string,
      assigneeName: (row.assignee_name as string) ?? null,
      assigneeEmail: row.assignee_email as string,
      assigneeInstitution: (row.assignee_institution as string) ?? null,
      creatorName: (row.creator_name as string) ?? null,
      creatorEmail: (row.creator_email as string) ?? null,
      patientId: (row.patient_id as string) ?? null,
      patientName: (row.patient_name as string) ?? null,
    };
  });

  const byAssigneeMap = new Map<string, TaskOverviewAssigneeSummary>();
  let totalOpen = 0;
  let overdueCount = 0;
  let dueSoon = 0;

  for (const t of tasks) {
    if (t.status !== 'open') continue;
    totalOpen += 1;
    if (t.overdue) overdueCount += 1;
    if (t.dueAt) {
      const due = new Date(t.dueAt).getTime();
      if (due >= now && due <= soonCutoff) dueSoon += 1;
    }
    let s = byAssigneeMap.get(t.assigneeUserId);
    if (!s) {
      s = { userId: t.assigneeUserId, name: t.assigneeName, email: t.assigneeEmail, open: 0, overdue: 0 };
      byAssigneeMap.set(t.assigneeUserId, s);
    }
    s.open += 1;
    if (t.overdue) s.overdue += 1;
  }

  const byAssignee = Array.from(byAssigneeMap.values()).sort(
    (a, b) => b.overdue - a.overdue || b.open - a.open,
  );

  return {
    tasks,
    summary: { totalOpen, overdue: overdueCount, dueSoon, byAssignee },
  };
}
