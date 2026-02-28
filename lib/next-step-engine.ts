/**
 * Next-step engine: deterministic computation of next required step for an episode.
 * Returns step_code, window, pool — or BLOCKED with required prereqs.
 * Used by worklist, forecast, and scheduling decisions.
 */

import { getDbPool } from './db';
import { computeStepWindow } from './step-window';

export type PoolType = 'consult' | 'work' | 'control';

export interface PathwayStep {
  label?: string;
  step_code: string;
  pool: PoolType;
  duration_minutes: number;
  default_days_offset: number;
  requires_precommit?: boolean;
  optional?: boolean;
}

export interface NextStepResult {
  step_code: string;
  label?: string;
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
  /** API 409 code when care_pathway missing */
  code?: 'NO_CARE_PATHWAY';
}

export type NextRequiredStepResult = NextStepResult | BlockedResult;

export function isBlocked(r: NextRequiredStepResult): r is BlockedResult {
  return 'status' in r && r.status === 'blocked';
}

export interface PendingStep extends NextStepResult {
  stepSeq: number;
  isFirstPending: boolean;
}

export type AllPendingStepsResult = PendingStep[] | BlockedResult;

export function isBlockedAll(r: AllPendingStepsResult): r is BlockedResult {
  return !Array.isArray(r) && 'status' in r && r.status === 'blocked';
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

/** Get completed appointment stats for episode: count and anchor date.
 * Used to compute next step index (completedCount) and window anchor (lastCompletedAt).
 * Anchors to start_time (when the appointment occurred), not created_at (when it was booked). */
async function getCompletedAppointmentStats(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<{ completedCount: number; lastCompletedAt: Date | null }> {
  const r = await pool.query(
    `SELECT
       COUNT(*)::int as completed_count,
       MAX(COALESCE(a.start_time, a.created_at)) as last_completed_at
     FROM appointments a
     WHERE a.episode_id = $1 AND a.appointment_status = 'completed'`,
    [episodeId]
  );
  const row = r.rows[0];
  return {
    completedCount: row?.completed_count ?? 0,
    lastCompletedAt: row?.last_completed_at ? new Date(row.last_completed_at) : null,
  };
}

export interface EpisodeStepRow {
  step_code: string;
  pathway_order_index: number;
  seq: number | null;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  completed_at: Date | null;
}

/** Get episode_steps if they've been generated. Returns null when no rows exist (legacy fallback).
 *  Ordered by seq (multi-pathway merged order) with pathway_order_index as fallback. */
async function getEpisodeSteps(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<EpisodeStepRow[] | null> {
  const r = await pool.query(
    `SELECT step_code, pathway_order_index, seq, status, completed_at
     FROM episode_steps WHERE episode_id = $1 ORDER BY COALESCE(seq, pathway_order_index), pathway_order_index`,
    [episodeId]
  );
  if (r.rows.length === 0) return null;
  return r.rows as EpisodeStepRow[];
}

/** Get episode anchor for window calculation when last_step_completed_at is null.
 * Fallback: opened_at (episode creation/activation). Deterministic, avoids new Date() drift. */
async function getEpisodeAnchorFallback(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<Date> {
  const r = await pool.query(
    `SELECT opened_at FROM patient_episodes WHERE id = $1`,
    [episodeId]
  );
  const openedAt = r.rows[0]?.opened_at;
  return openedAt ? new Date(openedAt) : new Date();
}

/** Get pathway steps for episode. Multi-pathway aware: merges steps from all episode_pathways.
 *  Falls back to legacy care_pathway_id when episode_pathways table is empty / absent. */
async function getPathwaySteps(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<PathwayStep[] | null> {
  // Try multi-pathway first
  try {
    const multiRow = await pool.query(
      `SELECT cp.steps_json FROM episode_pathways ep
       JOIN care_pathways cp ON ep.care_pathway_id = cp.id
       WHERE ep.episode_id = $1 ORDER BY ep.ordinal`,
      [episodeId]
    );
    if (multiRow.rows.length > 0) {
      const merged: PathwayStep[] = [];
      for (const row of multiRow.rows) {
        const arr = row.steps_json;
        if (Array.isArray(arr)) merged.push(...(arr as PathwayStep[]));
      }
      return merged.length > 0 ? merged : null;
    }
  } catch {
    // episode_pathways table might not exist yet
  }

  // Legacy fallback
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

  const [blocks, pathwaySteps, completedStats, episodeSteps] = await Promise.all([
    getActiveBlocks(pool, episodeId),
    getPathwaySteps(pool, episodeId),
    getCompletedAppointmentStats(pool, episodeId),
    getEpisodeSteps(pool, episodeId),
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

  // No pathway → cannot compute (explicit üzenet)
  if (!pathwaySteps || pathwaySteps.length === 0) {
    return {
      status: 'blocked',
      required_prereq_keys: ['care_pathway'],
      reason: 'Epizódhoz nincs hozzárendelve kezelési út. Először válasszon pathway-t.',
      block_keys: [],
      code: 'NO_CARE_PATHWAY',
    };
  }

  const currentStage = await getCurrentStage(pool, episodeId);

  // When episode_steps exist, use them as SSOT: find first pending step (skip over completed/skipped).
  // Anchor: latest completed_at among resolved steps, then fallback to appointment stats, then episode.opened_at.
  if (episodeSteps) {
    const resolvedSteps = episodeSteps.filter((s) => s.status === 'completed' || s.status === 'skipped');
    const pendingStep = episodeSteps.find((s) => s.status === 'pending' || s.status === 'scheduled');
    if (!pendingStep) {
      // All steps done or skipped — pathway complete; return last step as sentinel
      const lastStep = pathwaySteps[pathwaySteps.length - 1];
      return {
        step_code: lastStep.step_code,
        label: lastStep.label,
        pool: lastStep.pool,
        duration_minutes: lastStep.duration_minutes ?? 30,
        earliest_date: new Date(),
        latest_date: new Date(),
        reason: 'Pathway complete (all steps completed or skipped)',
        inputs_used: { completed_count: resolvedSteps.length, step_index: pathwaySteps.length, mode: 'episode_steps' },
      };
    }

    const matchingPathwayStep = pathwaySteps.find((ps) => ps.step_code === pendingStep.step_code)
      ?? pathwaySteps[Math.min(pendingStep.pathway_order_index, pathwaySteps.length - 1)];

    const lastResolvedAt = resolvedSteps
      .map((s) => s.completed_at)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    const anchorDate = lastResolvedAt
      ? new Date(lastResolvedAt)
      : completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));

    const daysOffset = matchingPathwayStep.default_days_offset ?? 14;
    const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);

    return {
      step_code: matchingPathwayStep.step_code,
      label: matchingPathwayStep.label,
      pool: matchingPathwayStep.pool,
      duration_minutes: matchingPathwayStep.duration_minutes ?? 30,
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: `Pathway step ${matchingPathwayStep.label ?? matchingPathwayStep.step_code}`,
      anchor: anchorDate.toISOString(),
      inputs_used: {
        resolved_count: resolvedSteps.length,
        last_resolved_at: lastResolvedAt ? new Date(lastResolvedAt).toISOString() : null,
        stage: currentStage,
        step_index: pendingStep.pathway_order_index,
        mode: 'episode_steps',
      },
    };
  }

  // Legacy fallback: no episode_steps generated yet — use appointment count
  const anchorDate =
    completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));
  const nextStepIndex = completedStats.completedCount;

  // For STAGE_0 (pre-consult): next step is first consult
  if (currentStage === 'STAGE_0') {
    const consultStep = pathwaySteps.find((s) => s.pool === 'consult');
    if (consultStep) {
      const daysOffset = consultStep.default_days_offset ?? 7;
      const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);
      return {
        step_code: consultStep.step_code,
        label: consultStep.label,
        pool: consultStep.pool,
        duration_minutes: consultStep.duration_minutes ?? 30,
        earliest_date: windowStart,
        latest_date: windowEnd,
        reason: 'First consultation',
        inputs_used: { stage: currentStage, mode: 'legacy_appointment_count' },
      };
    }
  }

  const step = pathwaySteps[Math.min(nextStepIndex, pathwaySteps.length - 1)];
  const daysOffset = step.default_days_offset ?? 14;
  const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);

  return {
    step_code: step.step_code,
    label: step.label,
    pool: step.pool,
    duration_minutes: step.duration_minutes ?? 30,
    earliest_date: windowStart,
    latest_date: windowEnd,
    reason: `Pathway step ${step.label ?? step.step_code}`,
    anchor: anchorDate.toISOString(),
    inputs_used: {
      completed_count: completedStats.completedCount,
      last_completed_at: completedStats.lastCompletedAt?.toISOString(),
      stage: currentStage,
      step_index: nextStepIndex,
      mode: 'legacy_appointment_count',
    },
  };
}

/**
 * Return ALL remaining pending steps for an episode (for look-ahead booking).
 * Each step gets a chained window: step N+1 anchors to step N's windowEnd.
 */
export async function allPendingSteps(episodeId: string): Promise<AllPendingStepsResult> {
  const pool = getDbPool();

  const [blocks, pathwaySteps, completedStats, episodeSteps] = await Promise.all([
    getActiveBlocks(pool, episodeId),
    getPathwaySteps(pool, episodeId),
    getCompletedAppointmentStats(pool, episodeId),
    getEpisodeSteps(pool, episodeId),
  ]);

  if (blocks.length > 0) {
    return {
      status: 'blocked',
      required_prereq_keys: blocks.map((b) => b.key),
      reason: `Episode blocked: ${blocks.map((b) => b.key).join(', ')}`,
      block_keys: blocks.map((b) => b.key),
    };
  }

  if (!pathwaySteps || pathwaySteps.length === 0) {
    return {
      status: 'blocked',
      required_prereq_keys: ['care_pathway'],
      reason: 'Epizódhoz nincs hozzárendelve kezelési út. Először válasszon pathway-t.',
      block_keys: [],
      code: 'NO_CARE_PATHWAY',
    };
  }

  if (episodeSteps) {
    const resolvedSteps = episodeSteps.filter((s) => s.status === 'completed' || s.status === 'skipped');
    const pendingSteps = episodeSteps.filter((s) => s.status === 'pending' || s.status === 'scheduled');

    if (pendingSteps.length === 0) return [];

    const lastResolvedAt = resolvedSteps
      .map((s) => s.completed_at)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    let anchor = lastResolvedAt
      ? new Date(lastResolvedAt)
      : completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));

    const results: PendingStep[] = [];
    for (let i = 0; i < pendingSteps.length; i++) {
      const pending = pendingSteps[i];
      const ps = pathwaySteps.find((p) => p.step_code === pending.step_code)
        ?? pathwaySteps[Math.min(pending.pathway_order_index, pathwaySteps.length - 1)];

      const daysOffset = ps.default_days_offset ?? 14;
      const { windowStart, windowEnd } = computeStepWindow(anchor, daysOffset);

      results.push({
        step_code: ps.step_code,
        label: ps.label,
        pool: ps.pool,
        duration_minutes: ps.duration_minutes ?? 30,
        earliest_date: windowStart,
        latest_date: windowEnd,
        reason: `Pathway step ${ps.label ?? ps.step_code}`,
        anchor: anchor.toISOString(),
        stepSeq: i,
        isFirstPending: i === 0,
      });

      anchor = windowEnd;
    }
    return results;
  }

  // Legacy fallback: no episode_steps — return remaining pathway steps by appointment count
  const anchorDate =
    completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));
  const nextStepIndex = completedStats.completedCount;
  const currentStage = await getCurrentStage(pool, episodeId);

  if (currentStage === 'STAGE_0') {
    const consultStep = pathwaySteps.find((s) => s.pool === 'consult');
    if (consultStep) {
      const daysOffset = consultStep.default_days_offset ?? 7;
      const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);
      return [{
        step_code: consultStep.step_code,
        label: consultStep.label,
        pool: consultStep.pool,
        duration_minutes: consultStep.duration_minutes ?? 30,
        earliest_date: windowStart,
        latest_date: windowEnd,
        reason: 'First consultation',
        stepSeq: 0,
        isFirstPending: true,
      }];
    }
  }

  const remaining = pathwaySteps.slice(nextStepIndex);
  if (remaining.length === 0) return [];

  let legacyAnchor = anchorDate;
  const results: PendingStep[] = [];
  for (let i = 0; i < remaining.length; i++) {
    const step = remaining[i];
    const daysOffset = step.default_days_offset ?? 14;
    const { windowStart, windowEnd } = computeStepWindow(legacyAnchor, daysOffset);
    results.push({
      step_code: step.step_code,
      label: step.label,
      pool: step.pool,
      duration_minutes: step.duration_minutes ?? 30,
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: `Pathway step ${step.label ?? step.step_code}`,
      anchor: legacyAnchor.toISOString(),
      stepSeq: i,
      isFirstPending: i === 0,
    });
    legacyAnchor = windowEnd;
  }
  return results;
}

/** Pre-loaded data for batch-optimized allPendingSteps (avoids N+1 queries). */
export interface EpisodeBatchData {
  blocks: Array<{ key: string; expires_at: Date }>;
  pathwaySteps: PathwayStep[] | null;
  completedStats: { completedCount: number; lastCompletedAt: Date | null };
  episodeSteps: EpisodeStepRow[] | null;
  openedAt: Date;
  currentStage: string | null;
}

/**
 * Batch-optimized allPendingSteps: identical logic to allPendingSteps but uses
 * pre-loaded data instead of per-episode DB queries. Reduces N×4 queries to 0.
 */
export function allPendingStepsWithData(
  episodeId: string,
  data: EpisodeBatchData
): AllPendingStepsResult {
  const { blocks, pathwaySteps, completedStats, episodeSteps, openedAt, currentStage } = data;

  if (blocks.length > 0) {
    return {
      status: 'blocked',
      required_prereq_keys: blocks.map((b) => b.key),
      reason: `Episode blocked: ${blocks.map((b) => b.key).join(', ')}`,
      block_keys: blocks.map((b) => b.key),
    };
  }

  if (!pathwaySteps || pathwaySteps.length === 0) {
    return {
      status: 'blocked',
      required_prereq_keys: ['care_pathway'],
      reason: 'Epizódhoz nincs hozzárendelve kezelési út. Először válasszon pathway-t.',
      block_keys: [],
      code: 'NO_CARE_PATHWAY',
    };
  }

  if (episodeSteps) {
    const resolvedSteps = episodeSteps.filter((s) => s.status === 'completed' || s.status === 'skipped');
    const pendingSteps = episodeSteps.filter((s) => s.status === 'pending' || s.status === 'scheduled');

    if (pendingSteps.length === 0) return [];

    const lastResolvedAt = resolvedSteps
      .map((s) => s.completed_at)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    let anchor = lastResolvedAt
      ? new Date(lastResolvedAt)
      : completedStats.lastCompletedAt ?? openedAt;

    const results: PendingStep[] = [];
    for (let i = 0; i < pendingSteps.length; i++) {
      const pending = pendingSteps[i];
      const ps = pathwaySteps.find((p) => p.step_code === pending.step_code)
        ?? pathwaySteps[Math.min(pending.pathway_order_index, pathwaySteps.length - 1)];

      const daysOffset = ps.default_days_offset ?? 14;
      const { windowStart, windowEnd } = computeStepWindow(anchor, daysOffset);

      results.push({
        step_code: ps.step_code,
        label: ps.label,
        pool: ps.pool,
        duration_minutes: ps.duration_minutes ?? 30,
        earliest_date: windowStart,
        latest_date: windowEnd,
        reason: `Pathway step ${ps.label ?? ps.step_code}`,
        anchor: anchor.toISOString(),
        stepSeq: i,
        isFirstPending: i === 0,
      });

      anchor = windowEnd;
    }
    return results;
  }

  // Legacy fallback: no episode_steps — use appointment count
  const anchorDate = completedStats.lastCompletedAt ?? openedAt;
  const nextStepIndex = completedStats.completedCount;

  if (currentStage === 'STAGE_0') {
    const consultStep = pathwaySteps.find((s) => s.pool === 'consult');
    if (consultStep) {
      const daysOffset = consultStep.default_days_offset ?? 7;
      const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);
      return [{
        step_code: consultStep.step_code,
        label: consultStep.label,
        pool: consultStep.pool,
        duration_minutes: consultStep.duration_minutes ?? 30,
        earliest_date: windowStart,
        latest_date: windowEnd,
        reason: 'First consultation',
        stepSeq: 0,
        isFirstPending: true,
      }];
    }
  }

  const remaining = pathwaySteps.slice(nextStepIndex);
  if (remaining.length === 0) return [];

  let legacyAnchor = anchorDate;
  const results: PendingStep[] = [];
  for (let i = 0; i < remaining.length; i++) {
    const step = remaining[i];
    const daysOffset = step.default_days_offset ?? 14;
    const { windowStart, windowEnd } = computeStepWindow(legacyAnchor, daysOffset);
    results.push({
      step_code: step.step_code,
      label: step.label,
      pool: step.pool,
      duration_minutes: step.duration_minutes ?? 30,
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: `Pathway step ${step.label ?? step.step_code}`,
      anchor: legacyAnchor.toISOString(),
      stepSeq: i,
      isFirstPending: i === 0,
    });
    legacyAnchor = windowEnd;
  }
  return results;
}
