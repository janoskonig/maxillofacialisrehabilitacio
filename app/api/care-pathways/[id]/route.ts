import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { carePathwayPatchSchema } from '@/lib/admin-process-schemas';
import { invalidateStepLabelCache } from '@/lib/step-labels';
import { invalidateUnmappedCache } from '@/lib/step-catalog-cache';

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
      `SELECT cp.id, cp.name, cp.reason, cp.treatment_type_id as "treatmentTypeId",
              cp.steps_json, cp.version, cp.priority,
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
 * DELETE /api/care-pathways/:id — delete pathway. Tiltás ha bármilyen epizód hivatkozik.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const pathwayId = params.id;
    const pool = getDbPool();

    const exists = await pool.query(
      `SELECT 1 FROM care_pathways WHERE id = $1`,
      [pathwayId]
    );
    if (exists.rows.length === 0) {
      return NextResponse.json({ error: 'Kezelési út nem található' }, { status: 404 });
    }

    const refs = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM patient_episodes WHERE care_pathway_id = $1`,
      [pathwayId]
    );
    if ((refs.rows[0]?.cnt ?? 0) > 0) {
      return NextResponse.json(
        {
          error: 'Nem törölhető: legalább egy epizód hivatkozik erre a kezelési útra.',
          code: 'PATHWAY_IN_USE',
        },
        { status: 409 }
      );
    }

    await pool.query(`DELETE FROM care_pathways WHERE id = $1`, [pathwayId]);

    const auditReason = request.nextUrl.searchParams.get('auditReason');
    console.info('[admin] care_pathway deleted', {
      pathwayId,
      by: auth.email ?? auth.userId,
      auditReason: auditReason ?? 'nincs',
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting care pathway:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési út törlésekor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/care-pathways/:id — update pathway (admin / fogpótlástanász). Zod validáció, optimistic concurrency, audit.
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
    const auditReason =
      body.auditReason ?? request.nextUrl.searchParams.get('auditReason');
    const parsed = carePathwayPatchSchema.safeParse({ ...body, auditReason });
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const data = parsed.data;

    const pool = getDbPool();

    const beforeResult = await pool.query(
      `SELECT id, name, reason, treatment_type_id, steps_json, version, priority, owner_id, updated_at as "updatedAt"
       FROM care_pathways WHERE id = $1`,
      [pathwayId]
    );
    if (beforeResult.rows.length === 0) {
      return NextResponse.json({ error: 'Kezelési út nem található' }, { status: 404 });
    }
    const before = beforeResult.rows[0];

    if (data.expectedUpdatedAt) {
      const expected = new Date(data.expectedUpdatedAt).getTime();
      const actual = before.updatedAt ? new Date(before.updatedAt).getTime() : 0;
      if (Math.abs(expected - actual) > 1000) {
        return NextResponse.json(
          {
            error: 'A kezelési út közben megváltozott. Kérjük frissítse és próbálja újra.',
            code: 'CONFLICT',
            current: before,
          },
          { status: 409 }
        );
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${idx}`);
      values.push(data.name);
      idx++;
    }
    if (data.reason !== undefined) {
      updates.push(`reason = $${idx}`);
      values.push(data.reason);
      updates.push(`treatment_type_id = $${idx + 1}`);
      values.push(null);
      idx += 2;
    }
    if (data.treatmentTypeId !== undefined) {
      updates.push(`treatment_type_id = $${idx}`);
      values.push(data.treatmentTypeId);
      updates.push(`reason = $${idx + 1}`);
      values.push(null);
      idx += 2;
    }
    if (data.stepsJson !== undefined) {
      updates.push(`steps_json = $${idx}`);
      values.push(JSON.stringify(data.stepsJson));
      idx++;
    }
    if (data.version !== undefined) {
      updates.push(`version = $${idx}`);
      values.push(data.version);
      idx++;
    }
    if (data.priority !== undefined) {
      updates.push(`priority = $${idx}`);
      values.push(data.priority);
      idx++;
    }
    if (data.ownerId !== undefined) {
      updates.push(`owner_id = $${idx}`);
      values.push(data.ownerId || null);
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

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (data.name !== undefined) changes.name = { old: before.name, new: data.name };
    if (data.reason !== undefined) changes.reason = { old: before.reason, new: data.reason };
    if (data.treatmentTypeId !== undefined)
      changes.treatment_type_id = { old: before.treatment_type_id, new: data.treatmentTypeId };
    if (data.stepsJson !== undefined) changes.steps_json = { old: before.steps_json, new: data.stepsJson };
    if (data.version !== undefined) changes.version = { old: before.version, new: data.version };
    if (data.priority !== undefined) changes.priority = { old: before.priority, new: data.priority };
    if (data.ownerId !== undefined) changes.owner_id = { old: before.owner_id, new: data.ownerId };

    const changedBy = auth.email ?? auth.userId ?? 'unknown';
    await pool.query(
      `INSERT INTO care_pathway_change_events (pathway_id, changed_by, change_type, change_details)
       VALUES ($1, $2, $3, $4)`,
      [pathwayId, changedBy, 'pathway_updated', JSON.stringify({ ...changes, auditReason: data.auditReason })]
    );

    if (data.stepsJson) {
      const stepsToUpsert = data.stepsJson.filter(
        (s: { step_code: string; label?: string }) => s.step_code && s.label
      );
      for (const s of stepsToUpsert) {
        await pool.query(
          `INSERT INTO step_catalog (step_code, label_hu)
           VALUES ($1, $2)
           ON CONFLICT (step_code) DO UPDATE SET label_hu = EXCLUDED.label_hu, updated_at = now()`,
          [s.step_code, s.label]
        );
      }
    }

    invalidateStepLabelCache();
    invalidateUnmappedCache();

    console.info('[admin] care_pathway updated', {
      pathwayId,
      by: changedBy,
      auditReason: data.auditReason,
    });

    const afterResult = await pool.query(
      `SELECT cp.id, cp.name, cp.reason, cp.treatment_type_id as "treatmentTypeId",
              cp.steps_json, cp.version, cp.priority,
              cp.owner_id as "ownerId",
              u.doktor_neve as "ownerName",
              cp.updated_at as "updatedAt"
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
