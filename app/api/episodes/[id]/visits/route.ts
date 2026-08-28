import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { createEpisodeVisit, listEpisodeVisits } from '@/lib/episode-visits';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/**
 * Epizód-státusz kapu tranzakción belül (a reorder route mintája): FOR SHARE
 * zárolt olvasás — a lezáró UPDATE-tel ütközik, olvasókkal nem.
 * Visszatérés: null = rendben; egyébként a kész hibaválasz.
 */
async function episodeOpenGate(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: Array<{ status?: string }> }> },
  episodeId: string
): Promise<NextResponse | null> {
  const ep = await client.query(
    `SELECT status FROM patient_episodes WHERE id = $1 FOR SHARE`,
    [episodeId]
  );
  if (ep.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (ep.rows[0].status !== 'open') {
    return NextResponse.json(
      { error: 'Lezárt epizód alkalmai nem módosíthatók', code: 'EPISODE_NOT_OPEN' },
      { status: 409 }
    );
  }
  return null;
}

/**
 * POST /api/episodes/:id/visits — új üres alkalom ("vizit") a lista végére.
 * Body: { label?, daysOffset?, plannedDurationMinutes? }
 */
export const POST = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json().catch(() => ({}));

  const daysOffset = body.daysOffset;
  if (daysOffset != null && (!Number.isInteger(daysOffset) || daysOffset < 0)) {
    return NextResponse.json(
      { error: 'A daysOffset nem-negatív egész nap legyen' },
      { status: 400 }
    );
  }
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 200) || null : null;
  const plannedDurationMinutes =
    Number.isInteger(body.plannedDurationMinutes) && body.plannedDurationMinutes > 0
      ? body.plannedDurationMinutes
      : null;

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gate = await episodeOpenGate(client, episodeId);
    if (gate) {
      await client.query('ROLLBACK');
      return gate;
    }

    const visit = await createEpisodeVisit(client, {
      episodeId,
      label,
      daysOffset: daysOffset ?? null,
      plannedDurationMinutes,
    });

    // WP-2.1 elv: a terv-mutáció naplózott — epizód-szintű sor (nincs fázis).
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: null,
      episodeId,
      oldStatus: null,
      newStatus: null,
      changedBy: auth.email ?? auth.userId ?? 'unknown',
      changeType: 'visit_change',
      reason: `Új alkalom létrehozva${label ? ` („${label}”)` : ''}`,
    });

    await client.query('COMMIT');

    try {
      await emitSchedulingEvent('episode', episodeId, 'visit_created');
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ visit }, { status: 201 });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/episodes/:id/visits — az alkalmak sorrendjének átírása.
 * Body: { orderedVisitIds: string[] } — az epizód ÖSSZES vizitjének új sorrendje.
 */
export const PATCH = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json().catch(() => ({}));
  const orderedVisitIds = body.orderedVisitIds;

  if (!Array.isArray(orderedVisitIds) || orderedVisitIds.some((v) => typeof v !== 'string')) {
    return NextResponse.json({ error: 'orderedVisitIds: string[] kötelező' }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gate = await episodeOpenGate(client, episodeId);
    if (gate) {
      await client.query('ROLLBACK');
      return gate;
    }

    const existing = await client.query(
      `SELECT id FROM episode_visits WHERE episode_id = $1 FOR UPDATE`,
      [episodeId]
    );
    const existingIds = new Set(existing.rows.map((r: { id: string }) => r.id));
    const providedIds = new Set(orderedVisitIds);
    if (
      existingIds.size !== providedIds.size ||
      Array.from(existingIds).some((id) => !providedIds.has(id as string))
    ) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Az orderedVisitIds nem az epizód alkalmainak teljes halmaza' },
        { status: 409 }
      );
    }

    for (let i = 0; i < orderedVisitIds.length; i++) {
      await client.query(
        `UPDATE episode_visits SET seq = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [i, orderedVisitIds[i]]
      );
    }

    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: null,
      episodeId,
      oldStatus: null,
      newStatus: null,
      changedBy: auth.email ?? auth.userId ?? 'unknown',
      changeType: 'visit_change',
      reason: `Alkalmak átrendezve (${orderedVisitIds.length} alkalom)`,
    });

    const visits = await listEpisodeVisits(client, episodeId);
    await client.query('COMMIT');

    try {
      await emitSchedulingEvent('episode', episodeId, 'visits_reordered');
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ visits });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
