import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { ensurePatientVisibleForUser, getUserInstitution } from '@/lib/consilium';
import { insertUserTask, listOpenTasksForStaff, type UserTaskRow } from '@/lib/user-tasks';
import { assertAssignableStaffUser } from '@/lib/task-assignee';
import { manualTaskSchema, type ManualTaskInput } from '@/lib/manual-task';

export const dynamic = 'force-dynamic';

function serializeTask(t: UserTaskRow) {
  return {
    id: t.id,
    assigneeKind: t.assigneeKind,
    patientId: t.patientId,
    patientName: t.patientName,
    taskType: t.taskType,
    status: t.status,
    title: t.title,
    description: t.description,
    metadata: t.metadata,
    sourceMessageId: t.sourceMessageId,
    sourceDoctorMessageId: t.sourceDoctorMessageId,
    dueAt: t.dueAt,
    viewedAt: t.viewedAt,
    createdAt: t.createdAt,
  };
}

export const GET = authedHandler(async (_req, { auth }) => {
  const tasks = await listOpenTasksForStaff(auth.userId);
  return NextResponse.json({
    success: true,
    tasks: tasks.map(serializeTask),
  });
});

/**
 * POST /api/user-tasks
 * Kézi ("manual") teendő létrehozása a Feladataim listára.
 * Címzett üres → magamnak; megadva → delegálás kollégának.
 */
export const POST = authedHandler(async (req, { auth }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Érvénytelen JSON' }, { status: 400 });
  }

  let parsed: ManualTaskInput;
  try {
    parsed = manualTaskSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.errors[0];
      return NextResponse.json(
        { error: first?.message ?? 'Érvénytelen adatok', details: e.flatten() },
        { status: 400 },
      );
    }
    throw e;
  }

  const pool = getDbPool();
  const institutionId = await getUserInstitution(auth);

  // Beteg-kontextus: csak olyan beteghez köthető, amit a felhasználó lát.
  if (parsed.patientId) {
    await ensurePatientVisibleForUser(parsed.patientId, auth, institutionId);
  }

  // Címzett feloldása: üres vagy önmaga → saját teendő; egyébként delegálás.
  let assigneeUserId = auth.userId;
  const delegating = !!parsed.assigneeUserId && parsed.assigneeUserId !== auth.userId;
  if (delegating) {
    if (!['admin', 'beutalo_orvos', 'fogpótlástanász'].includes(auth.role)) {
      return NextResponse.json(
        { error: 'Nincs jogosultság feladat delegálásához' },
        { status: 403 },
      );
    }
    const ok = await assertAssignableStaffUser(pool, parsed.assigneeUserId!, institutionId, auth.role);
    if (!ok) {
      return NextResponse.json(
        { error: 'A címzett nem található, inaktív, technikus, vagy nem kiosztható' },
        { status: 400 },
      );
    }
    assigneeUserId = parsed.assigneeUserId!;
  }

  const dueAtDate = parsed.dueAt ? new Date(parsed.dueAt) : null;

  const task = await insertUserTask({
    assigneeKind: 'staff',
    assigneeUserId,
    assigneePatientId: null,
    patientId: parsed.patientId ?? null,
    taskType: 'manual',
    title: parsed.title,
    description: parsed.description ?? null,
    metadata: {
      source: 'manual',
      remind: !!parsed.remind,
      createdByUserId: auth.userId,
    },
    createdByUserId: auth.userId,
    dueAt: dueAtDate && !Number.isNaN(dueAtDate.getTime()) ? dueAtDate : null,
  });

  return NextResponse.json({ success: true, task: serializeTask(task) });
});
