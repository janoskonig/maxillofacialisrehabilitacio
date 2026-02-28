import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { invalidateIntentsForEpisode } from '@/lib/intent-invalidation';
import { createInitialSlotIntentsForEpisode } from '@/lib/episode-activation';
import { getCurrentSuggestion } from '@/lib/stage-suggestion-service';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id — enhanced episode response with stageVersion, snapshotVersion, 
 * currentRulesetVersion, and stageSuggestion per the SSOT contract.
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
    const episodeId = params.id;

    const epRow = await pool.query(
      `SELECT pe.id, pe.patient_id as "patientId", pe.reason, pe.pathway_code as "pathwayCode",
        pe.chief_complaint as "chiefComplaint", pe.case_title as "caseTitle", pe.status,
        pe.opened_at as "openedAt", pe.closed_at as "closedAt",
        pe.parent_episode_id as "parentEpisodeId", pe.trigger_type as "triggerType",
        pe.created_at as "createdAt", pe.created_by as "createdBy",
        pe.care_pathway_id as "carePathwayId", pe.assigned_provider_id as "assignedProviderId",
        pe.treatment_type_id as "treatmentTypeId",
        pe.stage_version as "stageVersion", pe.snapshot_version as "snapshotVersion",
        cp.name as "carePathwayName",
        COALESCE(u.doktor_neve, u.email) as "assignedProviderName",
        tt.code as "treatmentTypeCode", tt.label_hu as "treatmentTypeLabel"
       FROM patient_episodes pe
       LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
       LEFT JOIN users u ON pe.assigned_provider_id = u.id
       LEFT JOIN treatment_types tt ON pe.treatment_type_id = tt.id
       WHERE pe.id = $1`,
      [episodeId]
    );

    if (epRow.rows.length === 0) {
      return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
    }

    const row = epRow.rows[0];

    const stageRow = await pool.query(
      `SELECT se.stage_code, sc.label_hu
       FROM stage_events se
       LEFT JOIN stage_catalog sc ON se.stage_code = sc.code AND sc.reason = $2
       WHERE se.episode_id = $1 ORDER BY se.at DESC LIMIT 1`,
      [episodeId, row.reason]
    );

    let currentRulesetVersion: number | null = null;
    try {
      const rulesetRow = await pool.query(
        `SELECT version FROM stage_transition_rulesets WHERE status = 'PUBLISHED' LIMIT 1`
      );
      currentRulesetVersion = rulesetRow.rows[0]?.version ?? null;
    } catch {
      // Table might not exist yet
    }

    let stageSuggestion = null;
    try {
      stageSuggestion = await getCurrentSuggestion(episodeId);
    } catch {
      // Table might not exist yet
    }

    let episodePathways: Array<{ id: string; carePathwayId: string; ordinal: number; pathwayName: string; stepCount: number }> = [];
    try {
      const epPaths = await pool.query(
        `SELECT ep.id, ep.care_pathway_id as "carePathwayId", ep.ordinal,
                cp.name as "pathwayName",
                (SELECT COUNT(*)::int FROM episode_steps es WHERE es.source_episode_pathway_id = ep.id) as "stepCount"
         FROM episode_pathways ep
         JOIN care_pathways cp ON ep.care_pathway_id = cp.id
         WHERE ep.episode_id = $1
         ORDER BY ep.ordinal`,
        [episodeId]
      );
      episodePathways = epPaths.rows;
    } catch {
      // episode_pathways table might not exist yet (pre-migration)
    }

    const episode = {
      id: row.id,
      patientId: row.patientId,
      reason: row.reason,
      pathwayCode: row.pathwayCode,
      chiefComplaint: row.chiefComplaint,
      caseTitle: row.caseTitle,
      status: row.status,
      openedAt: (row.openedAt as Date)?.toISOString?.() ?? String(row.openedAt),
      closedAt: row.closedAt ? (row.closedAt as Date)?.toISOString?.() ?? null : null,
      parentEpisodeId: row.parentEpisodeId,
      triggerType: row.triggerType,
      createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
      createdBy: row.createdBy,
      carePathwayId: row.carePathwayId,
      assignedProviderId: row.assignedProviderId,
      carePathwayName: row.carePathwayName,
      assignedProviderName: row.assignedProviderName,
      treatmentTypeId: row.treatmentTypeId,
      treatmentTypeCode: row.treatmentTypeCode,
      treatmentTypeLabel: row.treatmentTypeLabel,
      stageVersion: row.stageVersion ?? 0,
      snapshotVersion: row.snapshotVersion ?? 0,
      currentRulesetVersion,
      currentStageCode: stageRow.rows[0]?.stage_code ?? null,
      currentStageLabel: stageRow.rows[0]?.label_hu ?? null,
      stageSuggestion,
      episodePathways,
    };

    return NextResponse.json({ episode });
  } catch (error) {
    logger.error('Error in GET /episodes/:id:', error);
    return NextResponse.json(
      { error: 'Hiba az epizód lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/episodes/:id — update episode fields, or add/remove pathways.
 *
 * Standard fields: carePathwayId, carePathwayVersion, assignedProviderId, treatmentTypeId
 * Multi-pathway actions:
 *   { action: 'addPathway', carePathwayId: string }
 *   { action: 'removePathway', carePathwayId: string }
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
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultsága az epizód módosításához' }, { status: 403 });
    }

    const episodeId = params.id;
    const body = await request.json();
    const pool = getDbPool();

    // ── Multi-pathway actions ──────────────────────────────────────────
    if (body.action === 'addPathway') {
      return await handleAddPathway(pool, episodeId, body.carePathwayId);
    }
    if (body.action === 'removePathway') {
      return await handleRemovePathway(pool, episodeId, body.carePathwayId);
    }

    // ── Legacy / standard field update ─────────────────────────────────
    const { carePathwayId, carePathwayVersion, assignedProviderId, treatmentTypeId } = body;
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (carePathwayId !== undefined) {
      updates.push(`care_pathway_id = $${idx}`);
      values.push(carePathwayId || null);
      idx++;
    }
    if (carePathwayVersion !== undefined) {
      updates.push(`care_pathway_version = $${idx}`);
      values.push(carePathwayVersion ?? null);
      idx++;
    }
    if (assignedProviderId !== undefined) {
      updates.push(`assigned_provider_id = $${idx}`);
      values.push(assignedProviderId || null);
      idx++;
    }
    if (treatmentTypeId !== undefined) {
      updates.push(`treatment_type_id = $${idx}`);
      values.push(treatmentTypeId || null);
      idx++;
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nincs módosítandó mező' }, { status: 400 });
    }

    const before = await pool.query(
      `SELECT care_pathway_id, care_pathway_version, assigned_provider_id, treatment_type_id FROM patient_episodes WHERE id = $1`,
      [episodeId]
    );
    if (before.rows.length === 0) {
      return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
    }
    const prev = before.rows[0];

    const pathwayChanged =
      (carePathwayId !== undefined && String(prev.care_pathway_id ?? '') !== String(carePathwayId ?? '')) ||
      (carePathwayVersion !== undefined && prev.care_pathway_version !== carePathwayVersion);
    const providerChanged =
      assignedProviderId !== undefined && String(prev.assigned_provider_id ?? '') !== String(assignedProviderId ?? '');

    values.push(episodeId);
    await pool.query(
      `UPDATE patient_episodes SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    if (pathwayChanged) {
      try {
        await invalidateIntentsForEpisode(episodeId, 'pathway_changed');
      } catch (e) {
        logger.error('Failed to invalidate intents on pathway change:', e);
      }
    }
    if (providerChanged) {
      try {
        await invalidateIntentsForEpisode(episodeId, 'provider_changed');
      } catch (e) {
        logger.error('Failed to invalidate intents on provider change:', e);
      }
    }

    const after = await pool.query(
      `SELECT pe.id, pe.care_pathway_id as "carePathwayId", pe.care_pathway_version as "carePathwayVersion",
        pe.assigned_provider_id as "assignedProviderId", pe.treatment_type_id as "treatmentTypeId",
        tt.code as "treatmentTypeCode", tt.label_hu as "treatmentTypeLabel"
       FROM patient_episodes pe
       LEFT JOIN treatment_types tt ON pe.treatment_type_id = tt.id
       WHERE pe.id = $1`,
      [episodeId]
    );
    const episode = after.rows[0];

    // G1: Episode activation — create initial slot_intents for next 2 work steps when both pathway and provider are set
    if (episode?.carePathwayId && episode?.assignedProviderId) {
      try {
        await createInitialSlotIntentsForEpisode(episodeId);
      } catch (e) {
        logger.error('Failed to create initial slot intents on episode activation:', e);
      }
    }

    return NextResponse.json({ episode });
  } catch (error) {
    logger.error('Error updating episode:', error);
    return NextResponse.json(
      { error: 'Hiba történt az epizód módosításakor' },
      { status: 500 }
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-pathway helpers
// ────────────────────────────────────────────────────────────────────────────

async function handleAddPathway(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string,
  carePathwayId: unknown
) {
  if (!carePathwayId || typeof carePathwayId !== 'string') {
    return NextResponse.json({ error: 'carePathwayId kötelező (string UUID)' }, { status: 400 });
  }

  const ep = await pool.query(
    `SELECT id, status FROM patient_episodes WHERE id = $1`,
    [episodeId]
  );
  if (ep.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (ep.rows[0].status !== 'open') {
    return NextResponse.json({ error: 'Csak aktív epizódhoz adható pathway' }, { status: 400 });
  }

  const pw = await pool.query(
    `SELECT id, name, steps_json FROM care_pathways WHERE id = $1`,
    [carePathwayId]
  );
  if (pw.rows.length === 0) {
    return NextResponse.json({ error: 'Kezelési út nem található' }, { status: 404 });
  }

  const stepsJson = pw.rows[0].steps_json as Array<{
    step_code: string;
    pool?: string;
    duration_minutes?: number;
    default_days_offset?: number;
  }>;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Determine next ordinal
    const ordRow = await client.query(
      `SELECT COALESCE(MAX(ordinal), -1) + 1 as next_ord FROM episode_pathways WHERE episode_id = $1`,
      [episodeId]
    );
    const ordinal = ordRow.rows[0].next_ord;

    // Insert junction row (will fail on UNIQUE if already added)
    let epPathwayId: string;
    try {
      const ins = await client.query(
        `INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal)
         VALUES ($1, $2, $3) RETURNING id`,
        [episodeId, carePathwayId, ordinal]
      );
      epPathwayId = ins.rows[0].id;
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === '23505') {
        return NextResponse.json({ error: 'Ez a kezelési út már hozzá van rendelve ehhez az epizódhoz' }, { status: 409 });
      }
      throw e;
    }

    // Keep legacy care_pathway_id in sync (first added pathway)
    if (ordinal === 0) {
      await client.query(
        `UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2 AND care_pathway_id IS NULL`,
        [carePathwayId, episodeId]
      );
    }

    // Generate episode_steps for this pathway, appending after existing steps
    if (Array.isArray(stepsJson) && stepsJson.length > 0) {
      const maxSeqRow = await client.query(
        `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_steps WHERE episode_id = $1`,
        [episodeId]
      );
      let nextSeq: number = (maxSeqRow.rows[0].max_seq ?? -1) + 1;

      const insertValues: unknown[] = [];
      const insertPlaceholders: string[] = [];
      let pIdx = 1;

      for (let i = 0; i < stepsJson.length; i++) {
        const step = stepsJson[i];
        insertPlaceholders.push(
          `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7})`
        );
        insertValues.push(
          episodeId,
          step.step_code,
          i, // pathway_order_index
          step.pool ?? 'work',
          step.duration_minutes ?? 30,
          step.default_days_offset ?? 7,
          epPathwayId, // source_episode_pathway_id
          nextSeq + i  // seq
        );
        pIdx += 8;
      }

      await client.query(
        `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, source_episode_pathway_id, seq)
         VALUES ${insertPlaceholders.join(', ')}`,
        insertValues
      );
    }

    await client.query('COMMIT');

    // Invalidate intents so projector picks up new steps
    try {
      await invalidateIntentsForEpisode(episodeId, 'pathway_changed');
    } catch { /* non-blocking */ }

    // Return updated episode_pathways list
    const epPathways = await pool.query(
      `SELECT ep.id, ep.care_pathway_id as "carePathwayId", ep.ordinal,
              cp.name as "pathwayName",
              (SELECT COUNT(*)::int FROM episode_steps es WHERE es.source_episode_pathway_id = ep.id) as "stepCount"
       FROM episode_pathways ep
       JOIN care_pathways cp ON ep.care_pathway_id = cp.id
       WHERE ep.episode_id = $1
       ORDER BY ep.ordinal`,
      [episodeId]
    );

    return NextResponse.json({ episodePathways: epPathways.rows, added: true }, { status: 201 });
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
}

async function handleRemovePathway(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string,
  carePathwayId: unknown
) {
  if (!carePathwayId || typeof carePathwayId !== 'string') {
    return NextResponse.json({ error: 'carePathwayId kötelező (string UUID)' }, { status: 400 });
  }

  const epPathway = await pool.query(
    `SELECT ep.id FROM episode_pathways ep WHERE ep.episode_id = $1 AND ep.care_pathway_id = $2`,
    [episodeId, carePathwayId]
  );
  if (epPathway.rows.length === 0) {
    return NextResponse.json({ error: 'Ez a pathway nincs hozzárendelve az epizódhoz' }, { status: 404 });
  }
  const epPathwayId = epPathway.rows[0].id;

  // Guard: cannot remove if any step from this pathway is scheduled or completed
  const activeSteps = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM episode_steps
     WHERE source_episode_pathway_id = $1 AND status IN ('scheduled', 'completed')`,
    [epPathwayId]
  );
  if (activeSteps.rows[0].cnt > 0) {
    return NextResponse.json(
      { error: 'Nem távolítható el: van már időpontja vagy teljesített lépése ennek a kezelési útnak' },
      { status: 409 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete steps belonging to this pathway
    await client.query(
      `DELETE FROM episode_steps WHERE source_episode_pathway_id = $1`,
      [epPathwayId]
    );

    // Delete junction row
    await client.query(
      `DELETE FROM episode_pathways WHERE id = $1`,
      [epPathwayId]
    );

    // Re-sequence remaining steps
    await client.query(
      `WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY seq, pathway_order_index) - 1 as new_seq
        FROM episode_steps WHERE episode_id = $1
      )
      UPDATE episode_steps SET seq = numbered.new_seq
      FROM numbered WHERE episode_steps.id = numbered.id`,
      [episodeId]
    );

    // If legacy care_pathway_id pointed to the removed pathway, update to first remaining or NULL
    const remaining = await client.query(
      `SELECT care_pathway_id FROM episode_pathways WHERE episode_id = $1 ORDER BY ordinal LIMIT 1`,
      [episodeId]
    );
    const newLegacyId = remaining.rows[0]?.care_pathway_id ?? null;
    await client.query(
      `UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`,
      [newLegacyId, episodeId]
    );

    await client.query('COMMIT');

    try {
      await invalidateIntentsForEpisode(episodeId, 'pathway_changed');
    } catch { /* non-blocking */ }

    const epPathways = await pool.query(
      `SELECT ep.id, ep.care_pathway_id as "carePathwayId", ep.ordinal,
              cp.name as "pathwayName",
              (SELECT COUNT(*)::int FROM episode_steps es WHERE es.source_episode_pathway_id = ep.id) as "stepCount"
       FROM episode_pathways ep
       JOIN care_pathways cp ON ep.care_pathway_id = cp.id
       WHERE ep.episode_id = $1
       ORDER BY ep.ordinal`,
      [episodeId]
    );

    return NextResponse.json({ episodePathways: epPathways.rows, removed: true });
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
}
