/**
 * Episode forecast: compute remaining visits, completion window.
 * Extracted from /api/episodes/[id]/forecast. Used by batch API and cache refresh.
 */

import { createHash } from 'crypto';
import { getDbPool } from './db';
import { nextRequiredStep, isBlocked } from './next-step-engine';
import { normalizePathwayWorkPhaseArray } from './pathway-work-phases-for-episode';
import { getMergedFilterFragment } from './schema-probe';
import { projectRemainingVisits, computeCompletionWindow } from './episode-forecast-projection';
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

/** Batch compute inputs_hash for multiple episodes (5 queries total, not N×5). */
export async function computeInputsHashBatch(episodeIds: string[]): Promise<Map<string, string>> {
  if (episodeIds.length === 0) return new Map();
  const pool = getDbPool();

  const [episodeRows, pathwayRows, stageRows, statsRows, analyticsRows] = await Promise.all([
    pool.query(
      `SELECT pe.id, pe.care_pathway_id as "carePathwayId", pe.treatment_type_id as "treatmentTypeId"
       FROM patient_episodes pe WHERE pe.id = ANY($1)`,
      [episodeIds]
    ),
    pool.query(
      `SELECT pe.id as episode_id, cp.work_phases_json, cp.steps_json
       FROM patient_episodes pe
       LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
       WHERE pe.id = ANY($1)`,
      [episodeIds]
    ),
    pool.query(
      `SELECT DISTINCT ON (episode_id) episode_id, stage_code, at as "changedAt", id as "eventId"
       FROM stage_events WHERE episode_id = ANY($1)
       ORDER BY episode_id, at DESC`,
      [episodeIds]
    ),
    pool.query(
      `SELECT episode_id,
         COUNT(*) FILTER (WHERE appointment_status = 'completed')::int as "completedCount",
         COUNT(*) FILTER (WHERE start_time > CURRENT_TIMESTAMP
           AND (appointment_status IS NULL OR appointment_status != 'cancelled'))::int as "futureActiveCount",
         MAX(CASE WHEN appointment_status = 'completed' THEN COALESCE(start_time, created_at) END) as "lastCompletedAt",
         MIN(CASE WHEN start_time > CURRENT_TIMESTAMP
           AND (appointment_status IS NULL OR appointment_status != 'cancelled') THEN start_time END) as "nextBookedAt"
       FROM appointments WHERE episode_id = ANY($1)
       GROUP BY episode_id`,
      [episodeIds]
    ),
    pool.query(
      `SELECT pe.id as episode_id, cpa.median_visits, cpa.p80_visits, cpa.median_cadence_days,
              cpa.recorded_at as "updatedAt"
       FROM patient_episodes pe
       LEFT JOIN care_pathway_analytics cpa ON pe.care_pathway_id = cpa.care_pathway_id
       WHERE pe.id = ANY($1)`,
      [episodeIds]
    ),
  ]);

  const episodeMap = new Map(episodeRows.rows.map((r: any) => [r.id, r]));
  const pathwayMap = new Map(pathwayRows.rows.map((r: any) => [r.episode_id, r]));
  const stageMap = new Map(stageRows.rows.map((r: any) => [r.episode_id, r]));
  const statsMap = new Map(statsRows.rows.map((r: any) => [r.episode_id, r]));
  const analyticsMap = new Map(analyticsRows.rows.map((r: any) => [r.episode_id, r]));

  const result = new Map<string, string>();
  for (const id of episodeIds) {
    const episode = episodeMap.get(id);
    const pathway = pathwayMap.get(id);
    const stage = stageMap.get(id);
    const stats = statsMap.get(id);
    const analytics = analyticsMap.get(id);

    const normalizedPathway =
      normalizePathwayWorkPhaseArray(pathway?.work_phases_json) ??
      normalizePathwayWorkPhaseArray(pathway?.steps_json);
    const pathwayStepsHash =
      normalizedPathway && normalizedPathway.length > 0
        ? createHash('sha256').update(JSON.stringify(normalizedPathway)).digest('hex')
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

    const analyticsSignature = analytics?.median_visits != null
      ? {
          median_visits: analytics.median_visits,
          p80_visits: analytics.p80_visits,
          median_cadence_days: analytics.median_cadence_days,
          updated_at: analytics.updatedAt?.toISOString?.() ?? null,
        }
      : null;

    const payload = {
      episodeId: id,
      carePathwayId: episode?.carePathwayId ?? null,
      treatmentTypeId: episode?.treatmentTypeId ?? null,
      pathwayStepsHash,
      stageSignature,
      appointmentsSignature,
      analyticsSignature,
    };

    result.set(id, createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  }

  return result;
}

/** Deterministic hash of forecast inputs. Delegates to the batch version for a single episode. */
export async function computeInputsHash(episodeId: string): Promise<string> {
  const result = await computeInputsHashBatch([episodeId]);
  return result.get(episodeId) ?? createHash('sha256').update(episodeId).digest('hex');
}

/**
 * Progress inputs for the forecast projection: completed visits and the count of
 * concretely-remaining plan steps. `remainingSteps` is null when no work phases
 * have been generated for the episode yet (so the projection falls back to the
 * pathway heuristic instead of assuming "0 steps left").
 */
async function getForecastProgressInputs(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<{ completedVisits: number; remainingSteps: number | null }> {
  // Az alias a lenti query-ben `ewp` — a fragmentnek is ezt kell hivatkoznia,
  // különben `42P01 invalid reference to FROM-clause entry for table
  // "episode_work_phases"` (ugyanaz a hiba, mint a plan-validation route-ban volt).
  const mergedFilter = await getMergedFilterFragment(pool, 'ewp');
  const [apptRes, stepRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS c FROM appointments WHERE episode_id = $1 AND appointment_status = 'completed'`,
      [episodeId]
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('pending', 'scheduled'))::int AS remaining
       FROM episode_work_phases ewp
       WHERE ewp.episode_id = $1 ${mergedFilter}`,
      [episodeId]
    ),
  ]);
  const completedVisits = apptRes.rows[0]?.c ?? 0;
  const total = stepRes.rows[0]?.total ?? 0;
  return {
    completedVisits,
    remainingSteps: total > 0 ? (stepRes.rows[0]?.remaining ?? 0) : null,
  };
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

  const { completedVisits, remainingSteps } = await getForecastProgressInputs(pool, episodeId);

  let medianVisits: number | null = null;
  let p80Visits: number | null = null;
  let medianCadenceDays: number | null = null;
  let totalWorkSteps: number | null = null;

  if (episode.carePathwayId) {
    const [pathwayResult, analyticsResult] = await Promise.all([
      pool.query(`SELECT work_phases_json, steps_json FROM care_pathways WHERE id = $1`, [episode.carePathwayId]),
      pool.query(
        `SELECT median_visits, p80_visits, median_cadence_days FROM care_pathway_analytics WHERE care_pathway_id = $1`,
        [episode.carePathwayId]
      ),
    ]);
    const prow = pathwayResult.rows[0];
    const steps =
      normalizePathwayWorkPhaseArray(prow?.work_phases_json) ??
      normalizePathwayWorkPhaseArray(prow?.steps_json);
    totalWorkSteps = (steps?.filter((s) => s.pool === 'work') ?? []).length || null;

    const analytics = analyticsResult.rows[0];
    if (analytics?.median_visits != null && analytics?.p80_visits != null) {
      medianVisits = Number(analytics.median_visits);
      p80Visits = Number(analytics.p80_visits);
      medianCadenceDays = analytics.median_cadence_days != null ? Number(analytics.median_cadence_days) : null;
    }
  }

  const projection = projectRemainingVisits({
    hasCarePathway: Boolean(episode.carePathwayId),
    medianVisits,
    p80Visits,
    medianCadenceDays,
    completedVisits,
    remainingSteps,
    totalWorkSteps,
  });

  const { start: completionWindowStart, end: completionWindowEnd } = computeCompletionWindow(
    new Date(nextStepResult.earliest_date),
    new Date(nextStepResult.latest_date),
    projection
  );

  return {
    status: 'ready',
    assumptions: projection.assumptions,
    remainingVisitsP50: projection.remainingVisitsP50,
    remainingVisitsP80: projection.remainingVisitsP80,
    completionWindowStart: completionWindowStart.toISOString(),
    completionWindowEnd: completionWindowEnd.toISOString(),
    stepCode: nextStepResult.work_phase_code,
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

  // next_step column is VARCHAR(255) (migration 010). Truncate only if step_code exceeds that.
  const nextStepMaxLen = 255;
  const nextStep = result.stepCode != null && result.stepCode.length > nextStepMaxLen
    ? result.stepCode.slice(0, nextStepMaxLen)
    : result.stepCode ?? null;

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
      nextStep,
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
