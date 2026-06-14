import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { logActivityWithAuth } from '@/lib/activity';
import { assignKezeleoorvos } from '@/lib/kezeleoorvos-assignment';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * A beteg jelenlegi (ragadós) kezelőorvosa: orvos + intézmény + ki/mikor
 * delegálta. A számonkérés alapja — ki vállalta el a beteget.
 */
export const GET = authedHandler(async (_req, { params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  const res = await pool.query(
    `SELECT p.kezeleoorvos_user_id        AS "userId",
            p.kezeleoorvos                AS "name",
            p.kezeleoorvos_intezete       AS "intezmeny",
            p.kezeleoorvos_assigned_at    AS "assignedAt",
            p.kezeleoorvos_assigned_by    AS "assignedById",
            COALESCE(ab.doktor_neve, ab.email) AS "assignedByName"
       FROM patients p
       LEFT JOIN users ab ON ab.id = p.kezeleoorvos_assigned_by
      WHERE p.id = $1`,
    [patientId]
  );
  if (res.rows.length === 0) {
    throw new HttpError(404, 'Beteg nem található');
  }
  const row = res.rows[0];
  return NextResponse.json({
    kezeleoorvos: {
      userId: row.userId ?? null,
      name: row.name ?? null,
      intezmeny: row.intezmeny ?? null,
      assignedAt: row.assignedAt ?? null,
      assignedById: row.assignedById ?? null,
      assignedByName: row.assignedByName ?? null,
      // A hozzárendelés kézi (ragadós), ha van időbélyege.
      isManual: row.assignedAt != null,
    },
  });
});

/**
 * Kezelőorvos kézi (ragadós) hozzárendelése / átadása / lekapcsolása.
 * Body: { userId: string }  → hozzárendelés/átadás
 *       { userId: null }     → lekapcsolás (innentől a recompute újra seedelhet)
 */
export const PATCH = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth, params }) => {
  const patientId = params.id;
  const body = await req.json().catch(() => ({}));

  if (!('userId' in body)) {
    throw new HttpError(400, 'A `userId` mező kötelező (string vagy null).', 'MISSING_USER_ID');
  }
  const userId: string | null = body.userId ?? null;

  let result;
  try {
    result = await assignKezeleoorvos(patientId, userId, auth.userId, getDbPool());
  } catch (err) {
    logger.error('Kezelőorvos delegálás sikertelen:', err);
    throw new HttpError(400, err instanceof Error ? err.message : 'Hozzárendelés sikertelen');
  }

  await logActivityWithAuth(
    req,
    auth,
    userId === null ? 'kezeleoorvos_unassigned' : 'kezeleoorvos_assigned',
    `Patient ID: ${patientId}` +
      (userId === null ? ' — kezelőorvos lekapcsolva' : ` → ${result.name ?? userId}`)
  );

  return NextResponse.json({ kezeleoorvos: result });
});
