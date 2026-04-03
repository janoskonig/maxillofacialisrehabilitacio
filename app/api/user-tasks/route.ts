import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { listOpenTasksForStaff } from '@/lib/user-tasks';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (_req, { auth }) => {
  const tasks = await listOpenTasksForStaff(auth.userId);
  return NextResponse.json({
    success: true,
    tasks: tasks.map((t) => ({
      id: t.id,
      assigneeKind: t.assigneeKind,
      patientId: t.patientId,
      taskType: t.taskType,
      status: t.status,
      title: t.title,
      description: t.description,
      metadata: t.metadata,
      sourceMessageId: t.sourceMessageId,
      sourceDoctorMessageId: t.sourceDoctorMessageId,
      dueAt: t.dueAt,
      createdAt: t.createdAt,
    })),
  });
});
