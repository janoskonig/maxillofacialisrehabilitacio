import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { nextRequiredStep, isBlocked } from '@/lib/next-step-engine';
import { extractSuggestedTreatmentTypeCodes } from '@/lib/treatment-type-normalize';
import { getEffectiveTreatmentType } from '@/lib/effective-treatment-type';
import type { WorklistItemBackend } from '@/lib/worklist-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/worklists/wip-next-appointments
 * Returns WIP episodes with their next required step (from next-step engine or cache).
 * Uses episode_next_step_cache when available; falls back to next_required_step(episode).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();

    // patientId: opcionális szűrés – beteg profilnál per-patient worklist
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    // serverNowISO – offsetes ISO, egyetlen forrás (clock drift ellen)
    const serverNow = new Date();
    const serverNowISO = serverNow.toISOString();

    // Work pool foglalás: csak assigned_provider_id = user vagy NULL (admin mindent lát)
    const queryParams: string[] = [];
    let paramIndex = 1;
    const extraConditions: string[] = [];
    if (patientId) {
      extraConditions.push(`pe.patient_id = $${paramIndex}`);
      queryParams.push(patientId);
      paramIndex++;
    }
    if (auth.role !== 'admin') {
      extraConditions.push(`(pe.assigned_provider_id IS NULL OR pe.assigned_provider_id = $${paramIndex})`);
      queryParams.push(auth.userId);
      paramIndex++;
    }
    const extraWhere = extraConditions.length ? ' AND ' + extraConditions.join(' AND ') : '';

    // WIP episodes: status=open, stage in STAGE_1..STAGE_6 (not STAGE_0 or STAGE_7)
    const episodesResult = await pool.query(
      `SELECT DISTINCT pe.id as "episodeId", pe.patient_id as "patientId", pe.assigned_provider_id as "assignedProviderId",
              p.nev as "patientName", pe.opened_at as "openedAt"
       FROM patient_episodes pe
       JOIN patients p ON pe.patient_id = p.id
       LEFT JOIN (
         SELECT DISTINCT ON (episode_id) episode_id, stage_code
         FROM stage_events ORDER BY episode_id, at DESC
       ) se ON pe.id = se.episode_id
       WHERE pe.status = 'open'
       AND (se.stage_code IS NULL OR se.stage_code IN ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5','STAGE_6'))
       ${extraWhere}
       ORDER BY pe.opened_at ASC`,
      queryParams
    );

    const items: WorklistItemBackend[] = [];

    for (const row of episodesResult.rows) {
      const result = await nextRequiredStep(row.episodeId);

      if (isBlocked(result)) {
        const stageRow = await pool.query(
          `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
          [row.episodeId]
        );
        let suggestedTreatmentTypeCode: string | null = null;
        let suggestedTreatmentTypeLabel: string | null = null;
        if (result.code === 'NO_CARE_PATHWAY') {
          const patientRow = await pool.query(
            `SELECT kezelesi_terv_felso as "kezelesiTervFelso", kezelesi_terv_also as "kezelesiTervAlso"
             FROM patients WHERE id = $1`,
            [row.patientId]
          );
          const p = patientRow.rows[0];
          const suggested = extractSuggestedTreatmentTypeCodes(
            p?.kezelesiTervFelso,
            p?.kezelesiTervAlso
          );
          if (suggested.length > 0) {
            suggestedTreatmentTypeCode = suggested[0];
            const labelRow = await pool.query(
              `SELECT label_hu FROM treatment_types WHERE code = $1`,
              [suggestedTreatmentTypeCode]
            );
            suggestedTreatmentTypeLabel = labelRow.rows[0]?.label_hu ?? suggestedTreatmentTypeCode;
          }
        }
        items.push({
          episodeId: row.episodeId,
          patientId: row.patientId,
          patientName: row.patientName ?? null,
          currentStage: stageRow.rows[0]?.stage_code ?? 'STAGE_0',
          nextStep: '-',
          stepCode: undefined,
          overdueByDays: 0,
          windowStart: null,
          windowEnd: null,
          durationMinutes: 0,
          pool: 'work',
          priorityScore: 0,
          noShowRisk: 0,
          status: 'blocked',
          blockedReason: result.reason,
          ...(result.code && { blockedCode: result.code }),
          ...(suggestedTreatmentTypeCode && { suggestedTreatmentTypeCode }),
          ...(suggestedTreatmentTypeLabel && { suggestedTreatmentTypeLabel }),
        });
        continue;
      }

      const now = new Date();
      const windowEnd = new Date(result.latest_date);
      const overdueByDays = windowEnd < now ? Math.ceil((now.getTime() - windowEnd.getTime()) / (24 * 60 * 60 * 1000)) : 0;

      const priorityScore = Math.min(100, 50 + overdueByDays * 5);

      const patientNoShowResult = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM appointments a
         WHERE a.patient_id = $1 AND a.appointment_status = 'no_show'
         AND a.created_at > CURRENT_TIMESTAMP - INTERVAL '12 months'`,
        [row.patientId]
      );
      const noShowCount = patientNoShowResult.rows[0]?.cnt ?? 0;
      const noShowRisk = Math.min(0.95, 0.05 + noShowCount * 0.15);

      const stageResult = await pool.query(
        `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
        [row.episodeId]
      );
      const currentStage = stageResult.rows[0]?.stage_code ?? 'STAGE_0';

      const baseItem: WorklistItemBackend = {
        episodeId: row.episodeId,
        patientId: row.patientId,
        patientName: row.patientName ?? null,
        currentStage,
        nextStep: result.step_code,
        stepCode: result.step_code,
        overdueByDays,
        windowStart: result.earliest_date.toISOString(),
        windowEnd: result.latest_date.toISOString(),
        durationMinutes: result.duration_minutes,
        pool: result.pool,
        priorityScore,
        noShowRisk,
      };

      if (currentStage === 'STAGE_5') {
        const epRow = await pool.query(
          `SELECT pe.treatment_type_id as "episodeTreatmentTypeId", cp.treatment_type_id as "pathwayTreatmentTypeId"
           FROM patient_episodes pe
           LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
           WHERE pe.id = $1`,
          [row.episodeId]
        );
        const patientRow = await pool.query(
          `SELECT kezelesi_terv_felso as "kezelesiTervFelso", kezelesi_terv_also as "kezelesiTervAlso"
           FROM patients WHERE id = $1`,
          [row.patientId]
        );
        const ep = epRow.rows[0];
        const p = patientRow.rows[0];
        const effective = await getEffectiveTreatmentType(pool, {
          episodeTreatmentTypeId: ep?.episodeTreatmentTypeId,
          pathwayTreatmentTypeId: ep?.pathwayTreatmentTypeId,
          kezelesiTervFelso: p?.kezelesiTervFelso,
          kezelesiTervAlso: p?.kezelesiTervAlso,
        });
        if (effective.code || effective.label || effective.source) {
          baseItem.treatmentTypeCode = effective.code ?? undefined;
          baseItem.treatmentTypeLabel = effective.label ?? undefined;
          baseItem.treatmentTypeSource = effective.source ?? undefined;
        }
      }

      items.push(baseItem);
    }

    items.sort((a, b) => b.priorityScore - a.priorityScore);

    return NextResponse.json({
      items,
      serverNowISO,
    });
  } catch (error) {
    console.error('Error fetching WIP worklist:', error);
    return NextResponse.json(
      { error: 'Hiba történt a munkalista lekérdezésekor' },
      { status: 500 }
    );
  }
}
