import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { markTaskDoneForStaff } from '@/lib/user-tasks';
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
  if (body.status !== 'done') {
    return NextResponse.json({ error: 'Csak status: done támogatott' }, { status: 400 });
  }

  const ok = await markTaskDoneForStaff(taskId, ctx.auth.userId);
  if (!ok) {
    return NextResponse.json({ error: 'Feladat nem található vagy már lezárva' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});
