import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { cancelConsiliumMeetingTaskForUser, markTaskDoneForStaff } from '@/lib/user-tasks';
import { getUserInstitution } from '@/lib/consilium';
import { validateUUID } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const PATCH = authedHandler(async (req, ctx) => {
  let taskId: string;
  try {
    taskId = validateUUID(ctx.params.id, 'Feladat ID');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Érvénytelen ID';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const status = body?.status;

  if (status === 'done') {
    const ok = await markTaskDoneForStaff(taskId, ctx.auth.userId);
    if (!ok) {
      return NextResponse.json({ error: 'Feladat nem található vagy már lezárva' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  if (status === 'cancelled') {
    const institutionId = await getUserInstitution(ctx.auth);
    const ok = await cancelConsiliumMeetingTaskForUser(
      taskId,
      ctx.auth.userId,
      ctx.auth.role,
      institutionId,
    );
    if (!ok) {
      return NextResponse.json(
        { error: 'Feladat nem vonható vissza (nincs jogosultság, nem konzílium-feladat, vagy már nem nyitott)' },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Csak status: done vagy cancelled támogatott' }, { status: 400 });
});
