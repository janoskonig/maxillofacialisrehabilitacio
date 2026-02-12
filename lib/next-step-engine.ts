/**
 * Next-step engine: deterministic computation of next required step for an episode.
 * Returns step_code, window, pool — or BLOCKED with required prereqs.
 * Used by worklist, forecast, and scheduling decisions.
 */

import { getDbPool } from './db';

export type PoolType = 'consult' | 'work' | 'control';

export interface PathwayStep {
  step_code: string;
  pool: PoolType;
  duration_minutes: number;
  default_days_offset: number;
  requires_precommit?: boolean;
}

export interface NextStepResult {
  step_code: string;
  pool: PoolType;
  duration_minutes: number;
  earliest_date: Date;
  latest_date: Date;
  reason?: string;
  anchor?: string;
  inputs_used?: Record<string, unknown>;
}

export interface BlockedResult {
  status: 'blocked';
  required_prereq_keys: string[];
  reason: string;
  block_keys: string[];
}

export type NextRequiredStepResult = NextStepResult | BlockedResult;

export function isBlocked(r: NextRequiredStepResult): r is BlockedResult {
  return 'status' in r && r.status === 'blocked';
}

/** Get current stage code for an episode (latest stage_event) */
async function getCurrentStage(pool: Awaited<ReturnType<typeof getDbPool>>, episodeId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
    [episodeId]
  );
  return r.rows[0]?.stage_code ?? null;
}

/** Get active episode blocks */
async function getActiveBlocks(pool: Awaited<ReturnType<typeof getDbPool>>, episodeId: string): Promise<Array<{ key: string; expires_at: Date }>> {
  const r = await pool.query(
    `SELECT key, expires_at FROM episode_blocks WHERE episode_id = $1 AND active = true AND expires_at > CURRENT_TIMESTAMP`,
    [episodeId]
  );
  return r.rows.map((row: { key: string; expires_at: Date }) => ({ key: row.key, expires_at: row.expires_at }));
}

/** Get last completed appointment for episode (by type / pool) */
async function getLastCompletedAppointment(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<{ completed_at: Date; appointment_type?: string } | null> {
  const r = await pool.query(
    `SELECT a.created_at as completed_at, a.appointment_type
     FROM appointments a
     WHERE a.episode_id = $1 AND a.appointment_status = 'completed'
     ORDER BY a.created_at DESC LIMIT 1`,
    [episodeId]
  );
  return r.rows[0] ?? null;
}

/** Get pathway steps for episode */
async function getPathwaySteps(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<PathwayStep[] | null> {
  const r = await pool.query(
    `SELECT cp.steps_json FROM patient_episodes pe
     JOIN care_pathways cp ON pe.care_pathway_id = cp.id
     WHERE pe.id = $1`,
    [episodeId]
  );
  const stepsJson = r.rows[0]?.steps_json;
  if (!stepsJson || !Array.isArray(stepsJson)) return null;
  return stepsJson as PathwayStep[];
}

/**
 * Compute next required step for an episode.
 * Returns recommended window or BLOCKED with required prereqs.
 */
export async function nextRequiredStep(episodeId: string): Promise<NextRequiredStepResult> {
  const pool = getDbPool();

  const [blocks, pathwaySteps, lastCompleted] = await Promise.all([
    getActiveBlocks(pool, episodeId),
    getPathwaySteps(pool, episodeId),
    getLastCompletedAppointment(pool, episodeId),
  ]);

  // If episode has active blocks → BLOCKED
  if (blocks.length > 0) {
    return {
      status: 'blocked',
      required_prereq_keys: blocks.map((b) => b.key),
      reason: `Episode blocked: ${blocks.map((b) => b.key).join(', ')}`,
      block_keys: blocks.map((b) => b.key),
    };
  }

  // No pathway → cannot compute
  if (!pathwaySteps || pathwaySteps.length === 0) {
    return {
      status: 'blocked',
      required_prereq_keys: ['care_pathway'],
      reason: 'No care pathway assigned',
      block_keys: [],
    };
  }

  const currentStage = await getCurrentStage(pool, episodeId);
  const anchorDate = lastCompleted
    ? new Date(lastCompleted.completed_at)
    : new Date();

  // Linear progression: last completed -> next step index
  const nextStepIndex = lastCompleted ? 1 : 0;

  // For STAGE_0 (pre-consult): next step is first consult
  if (currentStage === 'STAGE_0') {
    const consultStep = pathwaySteps.find((s) => s.pool === 'consult');
    if (consultStep) {
      const daysOffset = consultStep.default_days_offset ?? 7;
      const earliest = new Date(anchorDate);
      earliest.setDate(earliest.getDate() + Math.max(0, daysOffset - 7));
      const latest = new Date(anchorDate);
      latest.setDate(latest.getDate() + daysOffset + 14);
      return {
        step_code: consultStep.step_code,
        pool: consultStep.pool,
        duration_minutes: consultStep.duration_minutes,
        earliest_date: earliest,
        latest_date: latest,
        reason: 'First consultation',
        inputs_used: { stage: currentStage },
      };
    }
  }

  const step = pathwaySteps[Math.min(nextStepIndex, pathwaySteps.length - 1)];
  const daysOffset = step.default_days_offset ?? 14;
  const earliest = new Date(anchorDate);
  earliest.setDate(earliest.getDate() + Math.max(0, daysOffset - 7));
  const latest = new Date(anchorDate);
  latest.setDate(latest.getDate() + daysOffset + 14);

  return {
    step_code: step.step_code,
    pool: step.pool,
    duration_minutes: step.duration_minutes,
    earliest_date: earliest,
    latest_date: latest,
    reason: `Pathway step ${step.step_code}`,
    anchor: anchorDate.toISOString(),
    inputs_used: {
      last_completed: lastCompleted?.completed_at,
      stage: currentStage,
      step_index: nextStepIndex,
    },
  };
}
