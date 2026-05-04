import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { getScopedSessionOrThrow, getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

/**
 * Az alkalom napirendje (csak betegnevek és sorrend) — a meghívóból nyitható
 * "Napirend megtekintése" linkhez. Csak az alkalom intézményéhez tartozó,
 * bejelentkezett felhasználó láthatja, így a beteg-azonosítók nem mennek emailbe.
 */
export const GET = authedHandler(async (_req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);

  const pool = getDbPool();
  const itemsRes = await pool.query<{
    sortOrder: number;
    discussed: boolean;
    name: string | null;
  }>(
    `SELECT i.sort_order as "sortOrder",
            i.discussed,
            pf.nev as "name"
     FROM consilium_session_items i
     LEFT JOIN patients_full pf ON pf.id = i.patient_id
     WHERE i.session_id = $1::uuid
     ORDER BY i.sort_order ASC`,
    [sessionId],
  );

  const items = itemsRes.rows.map((r) => ({
    sortOrder: r.sortOrder,
    discussed: !!r.discussed,
    name: r.name?.trim() || null,
  }));

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      scheduledAt:
        session.scheduledAt instanceof Date
          ? session.scheduledAt.toISOString()
          : String(session.scheduledAt),
      status: session.status,
    },
    items,
  });
});
