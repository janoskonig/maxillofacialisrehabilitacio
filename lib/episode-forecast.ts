/**
 * Episode forecast: compute remaining visits, completion window.
 * Extracted from /api/episodes/[id]/forecast. Used by batch API and cache refresh.
 */

import { createHash } from 'crypto';
import { getDbPool } from './db';
import { nextRequiredStep, isBlocked } from './next-step-engine';
import type { EpisodeForecastItem } from './forecast-types';

export interface EpisodeForecastResult {
  status: 'ready' | 'blocked';
  assumptions: string[];
  remainingVisitsP50?: number;
  remainingVisitsP80?: number;
  completionWindowStart?: string;
  completionWindowEnd?: string;
  stepCode?: string;
  nextStepWindow?: { start: string; end: string };
}

/** Batch compute inputs_hash for multiple episodes. Returns Map<episodeId, hash>. */
export async function computeInputsHashBatch(episodeIds: string[]): Promise<Map<string, string>> {
  if (episodeIds.length === 0) return new Map();
  const hashes = await Promise.all(episodeIds.map((id) => computeInputsHash(id)));
  return new Map(episodeIds.map((id, i) => [id, hashes[i]]));
}

/** Deterministic hash of forecast inputs. Do NOT include computed_at or time-dependent values. */
export async function computeInputsHash(episodeId: string): Promise<string> {
  const pool = getDbPool();

  const [episodeRow, pathwayRow, stageRow, statsRow, analyticsRow] = await Promise.all([
    pool.query(
      `SELECT pe.id, pe.care_pathway_id as "carePathwayId", pe.treatment_type_id as "treatmentTypeId"
       FROM patient_episodes pe WHERE pe.id = $1`,
      [episodeId]
    ),
    pool.query(
      `SELECT cp.steps_json FROM patient_episodes pe
       LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
       WHERE pe.id = $1`,
      [episodeId]
    ),
    pool.query(
      `SELECT se.stage_code, se.at as "changedAt", se.id as "eventId"
       FROM stage_events se WHERE se.episode_id = $1 ORDER BY se.at DESC LIMIT 1`,
      [episodeId]
    ),
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM appointments a WHERE a.episode_id = $1 AND a.appointment_status = 'completed') as "completedCount",
         (SELECT COUNT(*)::int FROM appointments a WHERE a.episode_id = $1 AND a.start_time > CURRENT_TIMESTAMP
          AND (a.appointment_status IS NULL OR a.appointment_status != 'cancelled')) as "futureActiveCount",
         (SELECT MAX(COALESCE(a.start_time, a.created_at)) FROM appointments a
          WHERE a.episode_id = $1 AND a.appointment_status = 'completed') as "lastCompletedAt",
         (SELECT MIN(a.start_time) FROM appointments a WHERE a.episode_id = $1
          AND a.start_time > CURRENT_TIMESTAMP AND (a.appointment_status IS NULL OR a.appointment_status != 'cancelled')) as "nextBookedAt"`,
      [episodeId]
    ),
    pool.query(
      `SELECT cpa.median_visits, cpa.p80_visits, cpa.median_cadence_days, cpa.recorded_at as "updatedAt"
       FROM patient_episodes pe
       LEFT JOIN care_pathway_analytics cpa ON pe.care_pathway_id = cpa.care_pathway_id
       WHERE pe.id = $1`,
      [episodeId]
    ),
  ]);

  const episode = episodeRow.rows[0];
  const pathway = pathwayRow.rows[0];
  const stage = stageRow.rows[0];
  const stats = statsRow.rows[0];
  const analytics = analyticsRow.rows[0];

  const stepsJson = pathway?.steps_json;
  const pathwayStepsHash = stepsJson != null
    ? createHash('sha256').update(JSON.stringify(stepsJson)).digest('hex')
    : '';

  const stageSignature = stage
    ? { stage_code: stage.stage_code, event_id: stage.eventId, changed_at: stage.changedAt?.toISOString?.() ?? null }
    : null;

  const appointmentsSignature = stats
    ? {
        completedCount: stats.completedCount ?? 0,
        futureActiveCount: stats.futureActiveCount ?? 0,
        lastCompletedAt: stats.lastCompletedAt?.toISOString?.() ?? null,
        nextBookedAt: stats.nextBookedAt?.toISOString?.() ?? null,
      }
    : null;

  const analyticsSignature = analytics
    ? {
        median_visits: analytics.median_visits,
        p80_visits: analytics.p80_visits,
        median_cadence_days: analytics.median_cadence_days,
        updated_at: analytics.updatedAt?.toISOString?.() ?? null,
      }
    : null;

  const payload = {
    episodeId,
    carePathwayId: episode?.carePathwayId ?? null,
    treatmentTypeId: episode?.treatmentTypeId ?? null,
    pathwayStepsHash,
    stageSignature,
    appointmentsSignature,
    analyticsSignature,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Compute episode forecast. Returns blocked or ready with ETA fields.
 */
export async function computeEpisodeForecast(episodeId: string): Promise<EpisodeForecastResult> {
  const pool = getDbPool();

  const episodeResult = await pool.query(
    `SELECT pe.id, pe.care_pathway_id as "carePathwayId"
     FROM patient_episodes pe WHERE pe.id = $1`,
    [episodeId]
  );

  if (episodeResult.rows.length === 0) {
    return {
      status: 'blocked',
      assumptions: ['BLOCKED_EPISODE_NOT_FOUND'],
    };
  }

  const episode = episodeResult.rows[0];
  const nextStepResult = await nextRequiredStep(episodeId);

  if (isBlocked(nextStepResult)) {
    const assumptions = ['BLOCKED_NO_CARE_PATHWAY'];
    if (nextStepResult.code) {
      assumptions[0] = `BLOCKED_${nextStepResult.code}`;
    }
    return {
      status: 'blocked',
      assumptions,
    };
  }

  let remainingVisitsP50: number;
  let remainingVisitsP80: number;
  let cadenceDays: number;
  let assumptions: string[] = ['NO_ANALYTICS_FALLBACK', 'CADENCE_DEFAULTED'];

  if (episode.carePathwayId) {
    const [pathwayResult, analyticsResult] = await Promise.all([
      pool.query(`SELECT steps_json FROM care_pathways WHERE id = $1`, [episode.carePathwayId]),
      pool.query(
        `SELECT median_visits, p80_visits, median_cadence_days FROM care_pathway_analytics WHERE care_pathway_id = $1`,
        [episode.carePathwayId]
      ),
    ]);
    const steps = pathwayResult.rows[0]?.steps_json as Array<{ step_code: string; pool: string }> | null;
    const analytics = analyticsResult.rows[0];

    if (analytics?.median_visits != null && analytics?.p80_visits != null) {
      remainingVisitsP50 = Math.max(1, Math.ceil(Number(analytics.median_visits)));
      remainingVisitsP80 = Math.max(remainingVisitsP50, Math.ceil(Number(analytics.p80_visits)));
      cadenceDays = analytics.median_cadence_days != null ? Number(analytics.median_cadence_days) : 14;
      assumptions = ['calibrated-pathway', 'cadence-from-analytics'];
    } else {
      const workSteps = (steps?.filter((s) => s.pool === 'work') ?? []).length || 4;
      remainingVisitsP50 = Math.max(1, Math.ceil(workSteps * 0.6));
      remainingVisitsP80 = Math.max(remainingVisitsP50, Math.ceil(workSteps * 0.9));
      cadenceDays = 14;
    }
  } else {
    remainingVisitsP50 = 4;
    remainingVisitsP80 = 6;
    cadenceDays = 14;
  }

  const completionWindowStart = new Date(nextStepResult.earliest_date);
  completionWindowStart.setDate(completionWindowStart.getDate() + remainingVisitsP50 * cadenceDays);
  const completionWindowEnd = new Date(nextStepResult.latest_date);
  completionWindowEnd.setDate(completionWindowEnd.getDate() + remainingVisitsP80 * cadenceDays);

  return {
    status: 'ready',
    assumptions,
    remainingVisitsP50,
    remainingVisitsP80,
    completionWindowStart: completionWindowStart.toISOString(),
    completionWindowEnd: completionWindowEnd.toISOString(),
    stepCode: nextStepResult.step_code,
    nextStepWindow: {
      start: nextStepResult.earliest_date.toISOString(),
      end: nextStepResult.latest_date.toISOString(),
    },
  };
}

/**
 * Compute forecast and upsert episode_forecast_cache.
 */
export async function refreshEpisodeForecastCache(episodeId: string): Promise<void> {
  const result = await computeEpisodeForecast(episodeId);
  const inputsHash = await computeInputsHash(episodeId);
  const pool = getDbPool();

  if (result.status === 'blocked') {
    await pool.query(
      `INSERT INTO episode_forecast_cache (episode_id, completion_end_p50, completion_end_p80, remaining_visits_p50, remaining_visits_p80, next_step, status, inputs_hash)
       VALUES ($1, NULL, NULL, NULL, NULL, NULL, 'blocked', $2)
       ON CONFLICT (episode_id) DO UPDATE SET
         completion_end_p50 = NULL,
         completion_end_p80 = NULL,
         remaining_visits_p50 = NULL,
         remaining_visits_p80 = NULL,
         next_step = NULL,
         status = 'blocked',
         inputs_hash = EXCLUDED.inputs_hash,
         computed_at = CURRENT_TIMESTAMP`,
      [episodeId, inputsHash]
    );
    return;
  }

  await pool.query(
    `INSERT INTO episode_forecast_cache (episode_id, completion_end_p50, completion_end_p80, remaining_visits_p50, remaining_visits_p80, next_step, status, inputs_hash)
     VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7)
     ON CONFLICT (episode_id) DO UPDATE SET
       completion_end_p50 = EXCLUDED.completion_end_p50,
       completion_end_p80 = EXCLUDED.completion_end_p80,
       remaining_visits_p50 = EXCLUDED.remaining_visits_p50,
       remaining_visits_p80 = EXCLUDED.remaining_visits_p80,
       next_step = EXCLUDED.next_step,
       status = 'ready',
       inputs_hash = EXCLUDED.inputs_hash,
       computed_at = CURRENT_TIMESTAMP`,
    [
      episodeId,
      result.completionWindowStart,
      result.completionWindowEnd,
      result.remainingVisitsP50,
      result.remainingVisitsP80,
      result.stepCode,
      inputsHash,
    ]
  );
}

/** Convert EpisodeForecastResult to EpisodeForecastItem for API response */
export function toEpisodeForecastItem(result: EpisodeForecastResult): EpisodeForecastItem {
  if (result.status === 'blocked') {
    return { status: 'blocked', assumptions: result.assumptions };
  }
  return {
    status: 'ready',
    assumptions: result.assumptions,
    remainingVisitsP50: result.remainingVisitsP50,
    remainingVisitsP80: result.remainingVisitsP80,
    completionWindowStart: result.completionWindowStart,
    completionWindowEnd: result.completionWindowEnd,
    stepCode: result.stepCode,
    nextStepWindow: result.nextStepWindow,
  };
}
