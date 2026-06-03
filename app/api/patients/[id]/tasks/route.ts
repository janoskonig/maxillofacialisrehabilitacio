import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { ensurePatientVisibleForUser, getUserInstitution } from '@/lib/consilium';
import { listStaffTasksForPatient, type PatientStaffTaskRow } from '@/lib/user-tasks';

export const dynamic = 'force-dynamic';

function serialize(t: PatientStaffTaskRow) {
  return {
    id: t.id,
    taskType: t.taskType,
    title: t.title,
    description: t.description,
    dueAt: t.dueAt,
    createdAt: t.createdAt,
    assigneeUserId: t.assigneeUserId,
    assigneeName: t.assigneeName,
    assigneeEmail: t.assigneeEmail,
    creatorName: t.creatorName,
    creatorEmail: t.creatorEmail,
  };
}

/**
 * GET /api/patients/:id/tasks
 * A beteghez kötött nyitott staff feladatok a felelős nevével — a beteg
 * kartonjának Adminisztráció fülén jelenik meg.
 */
export const GET = authedHandler(async (_req, { auth, params }) => {
  if (auth.role === 'technikus') {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
  }
  const patientId = params.id;
  const institutionId = await getUserInstitution(auth);
  await ensurePatientVisibleForUser(patientId, auth, institutionId);

  const tasks = await listStaffTasksForPatient(patientId);
  return NextResponse.json({ success: true, tasks: tasks.map(serialize) });
});
