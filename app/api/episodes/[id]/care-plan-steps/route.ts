import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { getStepLabelMap } from '@/lib/step-labels';
import { getEffectiveTreatmentType } from '@/lib/effective-treatment-type';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type PoolType = 'consult' | 'work' | 'control';

interface PathwayStepRaw {
  label?: string;
  step_code: string;
  pool: PoolType;
  duration_minutes?: number;
  default_days_offset?: number;
  requires_precommit?: boolean;
  optional?: boolean;
}

/**
 * GET /api/episodes/:id/care-plan-steps — canonical care plan steps for episode
 * Source: care_pathways.steps_json (episode.care_pathway_id). NOT stage_steps.
 * Kezelési terv = pathway steps; stage_steps megszűnt.
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

    const episodeId = params.id;
    const pool = getDbPool();

    const episodeResult = await pool.query(
      `SELECT pe.id, pe.patient_id as "patientId", pe.care_pathway_id as "carePathwayId",
              pe.treatment_type_id as "episodeTreatmentTypeId",
              cp.steps_json as "stepsJson", cp.treatment_type_id as "pathwayTreatmentTypeId"
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
        `SELECT kezelesi_terv_felso as "kezelesiTervFelso", kezelesi_terv_also as "kezelesiTervAlso"
         FROM patients WHERE id = $1`,
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

    const stepsJson = row.stepsJson;

    const currentStageResult = await pool.query(
      `SELECT stage_code as "stageCode" FROM stage_events
       WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
      [episodeId]
    );
    const currentStageCode = currentStageResult.rows[0]?.stageCode ?? null;

    const labelMap = await getStepLabelMap();

    const rawSteps: PathwayStepRaw[] =
      Array.isArray(stepsJson) && stepsJson.length > 0 ? stepsJson : [];

    const steps = rawSteps.map((s, idx) => {
      const poolVal = (s.pool === 'consult' || s.pool === 'work' || s.pool === 'control')
        ? s.pool
        : 'work';
      return {
        stepCode: s.step_code,
        pool: poolVal,
        orderIndex: idx,
        labelHu: s.label ?? labelMap.get(s.step_code) ?? s.step_code,
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
        source: 'care_pathways.steps_json',
        prostheticFilter: 'NONE',
      },
    });
  } catch (error) {
    logger.error('Error fetching care-plan-steps:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési terv lépéseinek lekérdezésekor' },
      { status: 500 }
    );
  }
}
