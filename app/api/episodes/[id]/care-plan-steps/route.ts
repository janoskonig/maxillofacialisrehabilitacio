import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { getStepLabelMap } from '@/lib/step-labels';
import { getEffectiveTreatmentType } from '@/lib/effective-treatment-type';
import { getPathwayWorkPhasesForEpisode } from '@/lib/pathway-work-phases-for-episode';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/care-plan-steps — canonical care plan steps for episode
 * Source: care_pathways.work_phases_json (fallback steps_json). NOT stage_steps.
 * Kezelési terv = pathway steps; stage_steps megszűnt.
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const episodeResult = await pool.query(
    `SELECT pe.id, pe.patient_id as "patientId", pe.care_pathway_id as "carePathwayId",
            pe.treatment_type_id as "episodeTreatmentTypeId",
            cp.treatment_type_id as "pathwayTreatmentTypeId"
     FROM patient_episodes pe
     LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
     WHERE pe.id = $1`,
    [episodeId]
  );

  if (episodeResult.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  const row = episodeResult.rows[0];
  const carePathwayId = row.carePathwayId ?? null;
  const patientId = row.patientId;

  let kezelesiTervFelso: Array<{ tipus?: string; treatmentTypeCode?: string }> | null = null;
  let kezelesiTervAlso: Array<{ tipus?: string; treatmentTypeCode?: string }> | null = null;
  if (patientId) {
    const patientResult = await pool.query(
      `SELECT t.kezelesi_terv_felso as "kezelesiTervFelso", t.kezelesi_terv_also as "kezelesiTervAlso"
       FROM patients p
       LEFT JOIN patient_treatment_plans t ON t.patient_id = p.id
       WHERE p.id = $1`,
      [patientId]
    );
    const p = patientResult.rows[0];
    kezelesiTervFelso = p?.kezelesiTervFelso ?? null;
    kezelesiTervAlso = p?.kezelesiTervAlso ?? null;
  }

  const effective = await getEffectiveTreatmentType(pool, {
    episodeTreatmentTypeId: row.episodeTreatmentTypeId,
    pathwayTreatmentTypeId: row.pathwayTreatmentTypeId,
    kezelesiTervFelso,
    kezelesiTervAlso,
  });

  const pathwayPhases = (await getPathwayWorkPhasesForEpisode(pool, episodeId)) ?? [];

  const currentStageResult = await pool.query(
    `SELECT stage_code as "stageCode" FROM stage_events
     WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
    [episodeId]
  );
  const currentStageCode = currentStageResult.rows[0]?.stageCode ?? null;

  const labelMap = await getStepLabelMap();

  const steps = pathwayPhases.map((s, idx) => {
    const poolVal = (s.pool === 'consult' || s.pool === 'work' || s.pool === 'control')
      ? s.pool
      : 'work';
    const code = s.work_phase_code;
    return {
      stepCode: code,
      pool: poolVal,
      orderIndex: idx,
      labelHu: s.label ?? labelMap.get(code) ?? code,
      isProstheticPhase: poolVal === 'work',
    };
  });

  return NextResponse.json({
    episodeId,
    carePathwayId,
    treatmentTypeCode: effective.code,
    treatmentTypeLabel: effective.label,
    treatmentTypeSource: effective.source,
    currentStageCode,
    steps,
    meta: {
      source: 'getPathwayWorkPhasesForEpisode',
      prostheticFilter: 'NONE',
    },
  });
});
