import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getUserInstitution } from '@/lib/consilium';
import { getStaffTaskOverview, type TaskOverviewStatus } from '@/lib/task-overview';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/overview?status=open|done|all
 * Vezetői feladat-áttekintés: minden munkatárs feladata a felelős és a beteg
 * nevével. Csak admin részére.
 */
export const GET = authedHandler(async (req, { auth }) => {
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Nincs jogosultság a vezetői nézethez' }, { status: 403 });
  }

  const statusParam = new URL(req.url).searchParams.get('status');
  const status: TaskOverviewStatus =
    statusParam === 'done' || statusParam === 'all' ? statusParam : 'open';

  const institutionId = await getUserInstitution(auth);
  const overview = await getStaffTaskOverview({ actorRole: auth.role, institutionId, status });

  return NextResponse.json({ success: true, ...overview });
});
