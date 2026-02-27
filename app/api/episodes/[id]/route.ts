import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { invalidateIntentsForEpisode } from '@/lib/intent-invalidation';
import { createInitialSlotIntentsForEpisode } from '@/lib/episode-activation';
import { getCurrentSuggestion } from '@/lib/stage-suggestion-service';

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
    };

    return NextResponse.json({ episode });
  } catch (error) {
    console.error('Error in GET /episodes/:id:', error);
    return NextResponse.json(
      { error: 'Hiba az epizód lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/episodes/:id — update episode (care_pathway_id, care_pathway_version, assigned_provider_id)
 * When care_pathway_id or care_pathway_version changes, invalidates open slot_intents.
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

    const pool = getDbPool();

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
        console.error('Failed to invalidate intents on pathway change:', e);
      }
    }
    if (providerChanged) {
      try {
        await invalidateIntentsForEpisode(episodeId, 'provider_changed');
      } catch (e) {
        console.error('Failed to invalidate intents on provider change:', e);
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
        console.error('Failed to create initial slot intents on episode activation:', e);
      }
    }

    return NextResponse.json({ episode });
  } catch (error) {
    console.error('Error updating episode:', error);
    return NextResponse.json(
      { error: 'Hiba történt az epizód módosításakor' },
      { status: 500 }
    );
  }
}
