import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { getUserInstitution } from '@/lib/consilium';
import { delegateStaffTask } from '@/lib/user-tasks';
import { assertAssignableStaffUser } from '@/lib/task-assignee';
import { validateUUID } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/user-tasks/:id/delegate
 * A jelenlegi címzett átadja a saját nyitott feladatát egy kollégának.
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  if (!['admin', 'beutalo_orvos', 'fogpótlástanász'].includes(auth.role)) {
    return NextResponse.json({ error: 'Nincs jogosultság feladat delegálásához' }, { status: 403 });
  }

  let taskId: string;
  let assigneeUserId: string;
  try {
    taskId = validateUUID(params.id, 'Feladat ID');
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Érvénytelen ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  try {
    assigneeUserId = validateUUID(body?.assigneeUserId, 'Címzett');
  } catch {
    return NextResponse.json({ error: 'Válassz címzettet' }, { status: 400 });
  }

  if (assigneeUserId === auth.userId) {
    return NextResponse.json({ error: 'A feladat már nálad van' }, { status: 400 });
  }

  const pool = getDbPool();
  const institutionId = await getUserInstitution(auth);

  const ok = await assertAssignableStaffUser(pool, assigneeUserId, institutionId, auth.role);
  if (!ok) {
    return NextResponse.json(
      { error: 'A címzett nem található, inaktív, technikus, vagy nem kiosztható' },
      { status: 400 },
    );
  }

  const delegated = await delegateStaffTask({
    taskId,
    fromUserId: auth.userId,
    toUserId: assigneeUserId,
  });
  if (!delegated) {
    return NextResponse.json(
      { error: 'A feladat nem delegálható (nem a tiéd, vagy már nem nyitott)' },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true });
});
