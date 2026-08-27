import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { mapPlanHistoryRow, type PlanHistoryDbRow } from '@/lib/plan-history';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /api/episodes/:id/plan-history — a kezelési terv változásnaplója (WP-2.2).
 *
 * Az `episode_work_phase_audit` sorai időrendben CSÖKKENŐ sorrendben,
 * lapozhatóan (`limit` + `offset`, default limit 20). Csak olvasás —
 * visszavonás-művelet nincs.
 *
 * A válasz sora tartalmazza:
 *  - mikor (createdAt), ki (changedBy — users.doktor_neve, ha a changed_by
 *    e-mail/uuid feloldható; rendszer-azonosítók, pl. 'auto-repair (…)',
 *    nyersen maradnak),
 *  - mi történt (changeType + oldStatus/newStatus),
 *  - melyik fázis (a 084-es snapshot oszlopokból — a törölt fázis sora is
 *    olvasható), és a reason.
 *  - `summary`: ember-olvasható magyar összefoglaló (lib/plan-history.ts —
 *    a fordítás egy helyen él).
 *
 * Az azonos tranzakcióban született sorok created_at-je azonos, ezért a
 * rendezés másodkulcsa az id — így a lapozás stabil (nincs dupla/kimaradó sor
 * két oldal határán).
 */
export const GET = authedHandler(async (req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const epRow = await pool.query(`SELECT id FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const rawOffset = Number.parseInt(url.searchParams.get('offset') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const [countResult, rowsResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM episode_work_phase_audit WHERE episode_id = $1`, [
      episodeId,
    ]),
    pool.query(
      // LATERAL + LIMIT 1: a changed_by feloldása sose sokszorozza a sorokat,
      // akkor sem, ha az e-mail/uuid egyezés többször találna.
      `SELECT a.id, a.created_at, a.changed_by, a.change_type, a.old_status, a.new_status,
              a.work_phase_code, a.custom_label, a.reason,
              u.doktor_neve AS changed_by_name,
              wpc.label_hu AS catalog_label
         FROM episode_work_phase_audit a
         LEFT JOIN LATERAL (
           SELECT doktor_neve
             FROM users
            WHERE email = a.changed_by OR id::text = a.changed_by
            LIMIT 1
         ) u ON true
         LEFT JOIN work_phase_catalog wpc ON wpc.work_phase_code = a.work_phase_code
        WHERE a.episode_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2 OFFSET $3`,
      [episodeId, limit, offset]
    ),
  ]);

  const count: number = countResult.rows[0]?.count ?? 0;
  const entries = (rowsResult.rows as PlanHistoryDbRow[]).map(mapPlanHistoryRow);

  return NextResponse.json({
    entries,
    count,
    limit,
    offset,
    hasMore: offset + entries.length < count,
  });
});
