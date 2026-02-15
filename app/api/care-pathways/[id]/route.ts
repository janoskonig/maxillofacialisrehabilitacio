import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/care-pathways/:id — single pathway with governance + change log
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();
    const pathwayId = params.id;

    const pathwayResult = await pool.query(
      `SELECT cp.id, cp.name, cp.reason, cp.steps_json, cp.version, cp.priority,
              cp.owner_id as "ownerId",
              u.doktor_neve as "ownerName",
              cp.created_at as "createdAt", cp.updated_at as "updatedAt"
       FROM care_pathways cp
       LEFT JOIN users u ON cp.owner_id = u.id
       WHERE cp.id = $1`,
      [pathwayId]
    );

    if (pathwayResult.rows.length === 0) {
      return NextResponse.json({ error: 'Kezelési út nem található' }, { status: 404 });
    }

    const pathway = pathwayResult.rows[0];

    const [governanceResult, changeLogResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT pe.id)::int as "episodeCount",
                COUNT(DISTINCT soa.id)::int as "overrideCount",
                CASE WHEN COUNT(DISTINCT pe.id) > 0
                  THEN ROUND(100.0 * COUNT(DISTINCT soa.id) / NULLIF(COUNT(DISTINCT pe.id), 0), 1)
                  ELSE 0 END as "overrideRatePct"
         FROM patient_episodes pe
         LEFT JOIN scheduling_override_audit soa ON soa.episode_id = pe.id
         WHERE pe.care_pathway_id = $1 AND pe.status = 'open'`,
        [pathwayId]
      ),
      pool.query(
        `SELECT id, change_type as "changeType", changed_by as "changedBy",
                change_details as "changeDetails", created_at as "createdAt"
         FROM care_pathway_change_events
         WHERE pathway_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [pathwayId]
      ),
    ]);

    const gov = governanceResult.rows[0] ?? { episodeCount: 0, overrideCount: 0, overrideRatePct: 0 };
    const DEGRADED_THRESHOLD_PCT = 20;

    return NextResponse.json({
      pathway: {
        ...pathway,
        governance: {
          episodeCount: gov.episodeCount ?? 0,
          overrideCount: gov.overrideCount ?? 0,
          overrideRatePct: gov.overrideRatePct ?? 0,
          degraded: (gov.overrideRatePct ?? 0) > DEGRADED_THRESHOLD_PCT,
        },
        changeLog: changeLogResult.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching care pathway:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési út lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/care-pathways/:id — update pathway (admin only). Emits care_pathway_change_events.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság a kezelési út módosításához' }, { status: 403 });
    }

    const pathwayId = params.id;
    const body = await request.json();
    const { name, reason, stepsJson, version, priority, ownerId } = body;

    const pool = getDbPool();

    const beforeResult = await pool.query(
      `SELECT id, name, reason, steps_json, version, priority, owner_id FROM care_pathways WHERE id = $1`,
      [pathwayId]
    );
    if (beforeResult.rows.length === 0) {
      return NextResponse.json({ error: 'Kezelési út nem található' }, { status: 404 });
    }
    const before = beforeResult.rows[0];

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx}`);
      values.push(name);
      idx++;
    }
    if (reason !== undefined) {
      updates.push(`reason = $${idx}`);
      values.push(reason);
      idx++;
    }
    if (stepsJson !== undefined) {
      updates.push(`steps_json = $${idx}`);
      values.push(JSON.stringify(stepsJson));
      idx++;
    }
    if (version !== undefined) {
      updates.push(`version = $${idx}`);
      values.push(version);
      idx++;
    }
    if (priority !== undefined) {
      updates.push(`priority = $${idx}`);
      values.push(priority);
      idx++;
    }
    if (ownerId !== undefined) {
      updates.push(`owner_id = $${idx}`);
      values.push(ownerId || null);
      idx++;
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nincs módosítandó mező' }, { status: 400 });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(pathwayId);

    await pool.query(
      `UPDATE care_pathways SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    // Emit change event for governance
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (name !== undefined) changes.name = { old: before.name, new: name };
    if (reason !== undefined) changes.reason = { old: before.reason, new: reason };
    if (stepsJson !== undefined) changes.steps_json = { old: before.steps_json, new: stepsJson };
    if (version !== undefined) changes.version = { old: before.version, new: version };
    if (priority !== undefined) changes.priority = { old: before.priority, new: priority };
    if (ownerId !== undefined) changes.owner_id = { old: before.owner_id, new: ownerId };

    const changedBy = auth.email ?? auth.userId ?? 'unknown';

    await pool.query(
      `INSERT INTO care_pathway_change_events (pathway_id, changed_by, change_type, change_details)
       VALUES ($1, $2, $3, $4)`,
      [pathwayId, changedBy, 'pathway_updated', JSON.stringify(changes)]
    );

    const afterResult = await pool.query(
      `SELECT cp.id, cp.name, cp.reason, cp.steps_json, cp.version, cp.priority,
              cp.owner_id as "ownerId",
              u.doktor_neve as "ownerName"
       FROM care_pathways cp
       LEFT JOIN users u ON cp.owner_id = u.id
       WHERE cp.id = $1`,
      [pathwayId]
    );

    return NextResponse.json({ pathway: afterResult.rows[0] });
  } catch (error) {
    console.error('Error updating care pathway:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési út módosításakor' },
      { status: 500 }
    );
  }
}
