import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { createEpisodeVisit, listEpisodeVisits } from '@/lib/episode-visits';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { DEFAULT_VISIT_GAP_DAYS } from '@/lib/visit-plan-constants';

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
 *
 * A `daysOffset` („ennyi nappal az előző alkalom után") elhagyva
 * DEFAULT_VISIT_GAP_DAYS (7 nap) — a vizitek között alapvetésként egy hét
 * telik el; a fázisnak magának nincs várakozási ideje.
 */
export const POST = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json().catch(() => ({}));
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'JSON objektum body szükséges' }, { status: 400 });
  }

  const daysOffset = body.daysOffset;
  if (daysOffset != null && (!Number.isInteger(daysOffset) || daysOffset < 0)) {
    return NextResponse.json(
      { error: 'A daysOffset nem-negatív egész nap legyen' },
      { status: 400 }
    );
  }
  if (body.plannedDurationMinutes != null &&
      (!Number.isInteger(body.plannedDurationMinutes) || body.plannedDurationMinutes <= 0)) {
    return NextResponse.json(
      { error: 'A plannedDurationMinutes pozitív egész perc legyen' },
      { status: 400 }
    );
  }
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 200) || null : null;
  const plannedDurationMinutes = body.plannedDurationMinutes ?? null;

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
      daysOffset: daysOffset ?? DEFAULT_VISIT_GAP_DAYS,
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
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'JSON objektum body szükséges' }, { status: 400 });
  }
  const orderedVisitIds = body.orderedVisitIds;

  if (!Array.isArray(orderedVisitIds) || orderedVisitIds.some((v) => typeof v !== 'string')) {
    return NextResponse.json({ error: 'orderedVisitIds: string[] kötelező' }, { status: 400 });
  }
  // Review-javítás: duplikált id a Set-validáción átcsúszna, és a szándékolt
  // sorrend nem az lenne, ami tárolódik.
  if (new Set(orderedVisitIds).size !== orderedVisitIds.length) {
    return NextResponse.json({ error: 'orderedVisitIds nem tartalmazhat ismétlődő azonosítót' }, { status: 400 });
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

    // Review-javítás: a sorrend igazsága az EWP COALESCE(seq, pathway_order_index)
    // — a forecast/next-step/projektor azon jár. A vizit-sorrend átírása a
    // fázis-seq-eket is átszámozza (vizit-sorrend, azon belül a mai sorrend),
    // különben a megjelenített alkalom-sorrend és a becslés némán széttartana.
    await client.query(
      `WITH ordered AS (
         SELECT e.id,
                ROW_NUMBER() OVER (
                  ORDER BY v_ord.ord NULLS LAST,
                           COALESCE(e.seq, e.pathway_order_index),
                           e.pathway_order_index, e.id
                ) - 1 AS new_seq
         FROM episode_work_phases e
         LEFT JOIN unnest($2::uuid[]) WITH ORDINALITY AS v_ord(visit_id, ord)
           ON e.visit_id = v_ord.visit_id
         WHERE e.episode_id = $1
       )
       UPDATE episode_work_phases SET seq = ordered.new_seq
       FROM ordered WHERE episode_work_phases.id = ordered.id`,
      [episodeId, orderedVisitIds]
    );

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
      await projectRemainingSteps(episodeId);
    } catch {
      /* non-blocking — a projektor a következő releváns eseménynél újrafut */
    }
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
