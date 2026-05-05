/**
 * Next-step engine: deterministic computation of next required work phase for an episode.
 * Returns work_phase_code, window, pool — or BLOCKED with required prereqs.
 * Used by worklist, forecast, and scheduling decisions.
 */

import { getDbPool } from './db';
import { computeStepWindow } from './step-window';
import {
  getPathwayWorkPhasesForEpisode,
  type PathwayWorkPhaseTemplate,
} from './pathway-work-phases-for-episode';
import {
  getMergedFilterFragment,
  probeColumnExists,
} from './schema-probe';

export type { PathwayWorkPhaseTemplate } from './pathway-work-phases-for-episode';

export type PoolType = 'consult' | 'work' | 'control';

export interface NextStepResult {
  work_phase_code: string;
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
  /** Episode step status — 'completed'/'skipped' for resolved steps, 'pending'/'scheduled' for upcoming */
  stepStatus?: 'pending' | 'scheduled' | 'completed' | 'skipped';
}

export type AllPendingStepsResult = PendingStep[] | BlockedResult;

export function isBlockedAll(r: AllPendingStepsResult): r is BlockedResult {
  return !Array.isArray(r) && 'status' in r && r.status === 'blocked';
}

const DEFAULT_CONSULT_STEP: PathwayWorkPhaseTemplate = {
  work_phase_code: 'consult_1',
  label: 'Első konzultáció',
  pool: 'consult',
  duration_minutes: 30,
  default_days_offset: 0,
};

/** Az átadást követő első három kontroll még munkafázis slotot igényel (annak számít). */
export function isFirstThreeControlStep(workPhaseCode: string): boolean {
  return /_kontroll_[123]$/.test(workPhaseCode);
}

/** Effective pool for slot allocation: first 3 controls use work slots. */
export function slotPoolForStep(step: { work_phase_code: string; pool: PoolType }): PoolType {
  if (step.pool === 'control' && isFirstThreeControlStep(step.work_phase_code)) return 'work';
  return step.pool;
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

export interface EpisodeWorkPhaseRow {
  work_phase_code: string;
  pathway_order_index: number;
  seq: number | null;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  completed_at: Date | null;
  merged_into_episode_work_phase_id: string | null;
  default_days_offset?: number | null;
  pool?: string | null;
  duration_minutes?: number | null;
  custom_label?: string | null;
}

/** Get episode_work_phases if they've been generated. Returns null when no rows exist.
 *  Ordered by seq (multi-pathway merged order) with pathway_order_index as fallback.
 *  Excludes merged (child) rows — they are handled as part of their primary row's appointment. */
async function getEpisodeWorkPhases(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<EpisodeWorkPhaseRow[] | null> {
  // A schema-probe modulszintű cache-ből szolgálja ki ezeket az ellenőrzéseket
  // (lib/schema-probe.ts) — egy request-en belül több hívásra is csak az
  // első jár DB-vel, a többi a cache-ből megy.
  const [mergedFilter, hasDefaultDaysOffset, hasCustomLabel] = await Promise.all([
    getMergedFilterFragment(pool, 'episode_work_phases'),
    probeColumnExists(pool, 'episode_work_phases', 'default_days_offset'),
    probeColumnExists(pool, 'episode_work_phases', 'custom_label'),
  ]);
  let optionalCols = '';
  if (hasDefaultDaysOffset) optionalCols += ', default_days_offset';
  if (hasCustomLabel) optionalCols += ', custom_label';

  const r = await pool.query(
    `SELECT work_phase_code, pathway_order_index, seq, status, completed_at, pool, duration_minutes${optionalCols}
     FROM episode_work_phases WHERE episode_id = $1 ${mergedFilter}
     ORDER BY COALESCE(seq, pathway_order_index), pathway_order_index`,
    [episodeId]
  );
  if (r.rows.length === 0) return null;
  return r.rows as EpisodeWorkPhaseRow[];
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

/** Synthesize a PathwayWorkPhaseTemplate from an EpisodeWorkPhaseRow when no matching pathway template exists
 *  (e.g. tooth treatment phases like tooth_huzas). */
function episodeWorkPhaseAsPathwayTemplate(es: EpisodeWorkPhaseRow): PathwayWorkPhaseTemplate {
  return {
    work_phase_code: es.work_phase_code,
    label: es.custom_label ?? undefined,
    pool: (es.pool as PoolType) ?? 'work',
    duration_minutes: es.duration_minutes ?? 30,
    default_days_offset: es.default_days_offset ?? 7,
  };
}

/** Per-episode sor nyer (custom_label, összevont blokk címe) a pathway sablon címével szemben. */
function displayLabelForEpisodeWorkPhase(
  episodeRow: EpisodeWorkPhaseRow,
  pathwayTemplate: PathwayWorkPhaseTemplate
): string {
  const custom = episodeRow.custom_label?.trim();
  if (custom) return custom;
  const tpl = pathwayTemplate.label?.trim();
  if (tpl) return tpl;
  return pathwayTemplate.work_phase_code;
}

/** Prefer per-episode duration (user-edited, incl. merged-slot total on primary row) over pathway template. */
function durationMinutesForEpisodeStep(
  episodeRow: { duration_minutes?: number | null },
  pathwayTemplate: PathwayWorkPhaseTemplate
): number {
  const fromEpisode = episodeRow.duration_minutes;
  if (typeof fromEpisode === 'number' && fromEpisode > 0) return fromEpisode;
  return pathwayTemplate.duration_minutes ?? 30;
}

/**
 * Compute next required step for an episode.
 * Returns recommended window or BLOCKED with required prereqs.
 */
export async function nextRequiredStep(episodeId: string): Promise<NextRequiredStepResult> {
  const pool = getDbPool();

  const [blocks, pathwayWorkPhases, completedStats, episodeWorkPhases] = await Promise.all([
    getActiveBlocks(pool, episodeId),
    getPathwayWorkPhasesForEpisode(pool, episodeId),
    getCompletedAppointmentStats(pool, episodeId),
    getEpisodeWorkPhases(pool, episodeId),
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

  const currentStage = await getCurrentStage(pool, episodeId);

  // When episode_work_phases exist, use them as SSOT (handles both pathway and tooth-treatment phases).
  if (episodeWorkPhases) {
    const resolvedSteps = episodeWorkPhases.filter((s) => s.status === 'completed' || s.status === 'skipped');
    const pendingStep = episodeWorkPhases.find((s) => s.status === 'pending' || s.status === 'scheduled');
    if (!pendingStep) {
      const lastStep = pathwayWorkPhases?.[pathwayWorkPhases.length - 1];
      const sentinel = lastStep ?? episodeWorkPhaseAsPathwayTemplate(episodeWorkPhases[episodeWorkPhases.length - 1]);
      return {
        work_phase_code: sentinel.work_phase_code,
        label: sentinel.label,
        pool: slotPoolForStep(sentinel),
        duration_minutes: sentinel.duration_minutes ?? 30,
        earliest_date: new Date(),
        latest_date: new Date(),
        reason: 'Pathway complete (all steps completed or skipped)',
        inputs_used: { completed_count: resolvedSteps.length, mode: 'episode_work_phases' },
      };
    }

    const matchingStep = pathwayWorkPhases?.find((ps) => ps.work_phase_code === pendingStep.work_phase_code)
      ?? episodeWorkPhaseAsPathwayTemplate(pendingStep);

    const lastResolvedAt = resolvedSteps
      .map((s) => s.completed_at)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    const anchorDate = lastResolvedAt
      ? new Date(lastResolvedAt)
      : completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));

    const daysOffset = pendingStep.default_days_offset ?? matchingStep.default_days_offset ?? 14;
    const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);

    return {
      work_phase_code: matchingStep.work_phase_code,
      label: displayLabelForEpisodeWorkPhase(pendingStep, matchingStep),
      pool: slotPoolForStep(matchingStep),
      duration_minutes: durationMinutesForEpisodeStep(pendingStep, matchingStep),
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: `Pathway step ${matchingStep.label ?? matchingStep.work_phase_code}`,
      anchor: anchorDate.toISOString(),
      inputs_used: {
        resolved_count: resolvedSteps.length,
        last_resolved_at: lastResolvedAt ? new Date(lastResolvedAt).toISOString() : null,
        stage: currentStage,
        step_index: pendingStep.pathway_order_index,
        mode: 'episode_work_phases',
      },
    };
  }

  // No pathway and no episode_work_phases → default to first consultation
  if (!pathwayWorkPhases || pathwayWorkPhases.length === 0) {
    const anchorDate =
      completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));
    const { windowStart, windowEnd } = computeStepWindow(anchorDate, DEFAULT_CONSULT_STEP.default_days_offset);
    return {
      work_phase_code: DEFAULT_CONSULT_STEP.work_phase_code,
      label: DEFAULT_CONSULT_STEP.label,
      pool: DEFAULT_CONSULT_STEP.pool,
      duration_minutes: DEFAULT_CONSULT_STEP.duration_minutes,
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: 'Első konzultáció (nincs pathway)',
      anchor: anchorDate.toISOString(),
      inputs_used: { mode: 'no_pathway_default_consult' },
    };
  }

  // Legacy fallback: no episode_work_phases generated yet — use appointment count
  const anchorDate =
    completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));
  const nextStepIndex = completedStats.completedCount;

  // For STAGE_0 (pre-consult): next step is first consult
  if (currentStage === 'STAGE_0') {
    const consultStep = pathwayWorkPhases.find((s) => s.pool === 'consult');
    if (consultStep) {
      const daysOffset = consultStep.default_days_offset ?? 7;
      const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);
      return {
        work_phase_code: consultStep.work_phase_code,
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

  const step = pathwayWorkPhases[Math.min(nextStepIndex, pathwayWorkPhases.length - 1)];
  const daysOffset = step.default_days_offset ?? 14;
  const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);

  return {
    work_phase_code: step.work_phase_code,
    label: step.label,
    pool: slotPoolForStep(step),
    duration_minutes: step.duration_minutes ?? 30,
    earliest_date: windowStart,
    latest_date: windowEnd,
    reason: `Pathway step ${step.label ?? step.work_phase_code}`,
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
 * Each step gets a chained window: step N+1 anchors to step N's expectedDate.
 */
export async function allPendingSteps(episodeId: string): Promise<AllPendingStepsResult> {
  const pool = getDbPool();

  const [blocks, pathwayWorkPhases, completedStats, episodeWorkPhases] = await Promise.all([
    getActiveBlocks(pool, episodeId),
    getPathwayWorkPhasesForEpisode(pool, episodeId),
    getCompletedAppointmentStats(pool, episodeId),
    getEpisodeWorkPhases(pool, episodeId),
  ]);

  if (blocks.length > 0) {
    return {
      status: 'blocked',
      required_prereq_keys: blocks.map((b) => b.key),
      reason: `Episode blocked: ${blocks.map((b) => b.key).join(', ')}`,
      block_keys: blocks.map((b) => b.key),
    };
  }

  // When episode_work_phases exist, use them as SSOT (handles both pathway and tooth-treatment phases).
  if (episodeWorkPhases) {
    const resolvedSteps = episodeWorkPhases.filter((s) => s.status === 'completed' || s.status === 'skipped');
    const pendingSteps = episodeWorkPhases.filter((s) => s.status === 'pending' || s.status === 'scheduled');

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
      const ps = pathwayWorkPhases?.find((p) => p.work_phase_code === pending.work_phase_code)
        ?? episodeWorkPhaseAsPathwayTemplate(pending);

      const daysOffset = (pending.default_days_offset ?? ps.default_days_offset) ?? 14;
      const { windowStart, windowEnd, expectedDate } = computeStepWindow(anchor, daysOffset);

      results.push({
        work_phase_code: ps.work_phase_code,
        label: displayLabelForEpisodeWorkPhase(pending, ps),
        pool: slotPoolForStep(ps),
        duration_minutes: durationMinutesForEpisodeStep(pending, ps),
        earliest_date: windowStart,
        latest_date: windowEnd,
        reason: `Pathway step ${ps.label ?? ps.work_phase_code}`,
        anchor: anchor.toISOString(),
        stepSeq: i,
        isFirstPending: i === 0,
      });

      anchor = expectedDate;
    }
    return results;
  }

  // No pathway and no episode_work_phases → default to first consultation
  if (!pathwayWorkPhases || pathwayWorkPhases.length === 0) {
    const anchorDate =
      completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));
    const { windowStart, windowEnd } = computeStepWindow(anchorDate, DEFAULT_CONSULT_STEP.default_days_offset);
    return [{
      work_phase_code: DEFAULT_CONSULT_STEP.work_phase_code,
      label: DEFAULT_CONSULT_STEP.label,
      pool: DEFAULT_CONSULT_STEP.pool,
      duration_minutes: DEFAULT_CONSULT_STEP.duration_minutes,
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: 'Első konzultáció (nincs pathway)',
      anchor: anchorDate.toISOString(),
      stepSeq: 0,
      isFirstPending: true,
    }];
  }

  // Legacy fallback: no episode_work_phases — return remaining pathway phases by appointment count
  const anchorDate =
    completedStats.lastCompletedAt ?? (await getEpisodeAnchorFallback(pool, episodeId));
  const nextStepIndex = completedStats.completedCount;
  const currentStage = await getCurrentStage(pool, episodeId);

  if (currentStage === 'STAGE_0') {
    const consultStep = pathwayWorkPhases.find((s) => s.pool === 'consult');
    if (consultStep) {
      const daysOffset = consultStep.default_days_offset ?? 7;
      const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);
      return [{
        work_phase_code: consultStep.work_phase_code,
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

  const remaining = pathwayWorkPhases.slice(nextStepIndex);
  if (remaining.length === 0) return [];

  let legacyAnchor = anchorDate;
  const results: PendingStep[] = [];
  for (let i = 0; i < remaining.length; i++) {
    const step = remaining[i];
    const daysOffset = step.default_days_offset ?? 14;
    const { windowStart, windowEnd, expectedDate } = computeStepWindow(legacyAnchor, daysOffset);
    results.push({
      work_phase_code: step.work_phase_code,
      label: step.label,
      pool: slotPoolForStep(step),
      duration_minutes: step.duration_minutes ?? 30,
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: `Pathway step ${step.label ?? step.work_phase_code}`,
      anchor: legacyAnchor.toISOString(),
      stepSeq: i,
      isFirstPending: i === 0,
    });
    legacyAnchor = expectedDate;
  }
  return results;
}

/** Pre-loaded data for batch-optimized allPendingSteps (avoids N+1 queries). */
export interface EpisodeBatchData {
  blocks: Array<{ key: string; expires_at: Date }>;
  pathwayWorkPhases: PathwayWorkPhaseTemplate[] | null;
  completedStats: { completedCount: number; lastCompletedAt: Date | null };
  episodeWorkPhases: EpisodeWorkPhaseRow[] | null;
  openedAt: Date;
  currentStage: string | null;
}

/**
 * Batch-optimized allPendingSteps: identical logic to allPendingSteps but uses
 * pre-loaded data instead of per-episode DB queries. Reduces N×4 queries to 0.
 *
 * Note: a step "BOOKED" jelölést nem itt csináljuk, hanem a route rétegben a
 * `sqlBookedFutureAppointmentsWithEffectiveStep` enrichment-en keresztül
 * (lásd `bookedAppointmentId` mezők). Itt csak a következő pending lépéseket
 * tükrözzük; a state-derivation a UI oldalán dönti el, hogy a row READY vagy
 * BOOKED.
 */
export function allPendingStepsWithData(
  episodeId: string,
  data: EpisodeBatchData
): AllPendingStepsResult {
  const { blocks, pathwayWorkPhases, completedStats, episodeWorkPhases, openedAt, currentStage } = data;

  if (blocks.length > 0) {
    return {
      status: 'blocked',
      required_prereq_keys: blocks.map((b) => b.key),
      reason: `Episode blocked: ${blocks.map((b) => b.key).join(', ')}`,
      block_keys: blocks.map((b) => b.key),
    };
  }

  // When episode_work_phases exist, use them as SSOT (handles both pathway and tooth-treatment phases).
  // Returns ALL steps (completed, skipped, pending, scheduled) so the UI can display the full timeline.
  if (episodeWorkPhases) {
    const resolvedSteps = episodeWorkPhases.filter((s) => s.status === 'completed' || s.status === 'skipped');
    const pendingSteps = episodeWorkPhases.filter((s) => s.status === 'pending' || s.status === 'scheduled');

    const lastResolvedAt = resolvedSteps
      .map((s) => s.completed_at)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    let anchor = lastResolvedAt
      ? new Date(lastResolvedAt)
      : completedStats.lastCompletedAt ?? openedAt;

    const results: PendingStep[] = [];

    // First: resolved (completed/skipped) steps — shown as history
    for (let i = 0; i < resolvedSteps.length; i++) {
      const step = resolvedSteps[i];
      const ps = pathwayWorkPhases?.find((p) => p.work_phase_code === step.work_phase_code)
        ?? episodeWorkPhaseAsPathwayTemplate(step);
      const completedDate = step.completed_at ? new Date(step.completed_at) : openedAt;
      results.push({
        work_phase_code: ps.work_phase_code,
        label: displayLabelForEpisodeWorkPhase(step, ps),
        pool: slotPoolForStep(ps),
        duration_minutes: durationMinutesForEpisodeStep(step, ps),
        earliest_date: completedDate,
        latest_date: completedDate,
        reason: step.status === 'completed' ? 'Teljesítve' : 'Kihagyva',
        stepSeq: -(resolvedSteps.length - i),
        isFirstPending: false,
        stepStatus: step.status as 'completed' | 'skipped',
      });
    }

    // Then: pending/scheduled steps — shown for booking
    let pendingIdx = 0;
    for (const pending of pendingSteps) {
      const ps = pathwayWorkPhases?.find((p) => p.work_phase_code === pending.work_phase_code)
        ?? episodeWorkPhaseAsPathwayTemplate(pending);

      const daysOffset = (pending.default_days_offset ?? ps.default_days_offset) ?? 14;
      const { windowStart, windowEnd, expectedDate } = computeStepWindow(anchor, daysOffset);

      results.push({
        work_phase_code: ps.work_phase_code,
        label: displayLabelForEpisodeWorkPhase(pending, ps),
        pool: slotPoolForStep(ps),
        duration_minutes: durationMinutesForEpisodeStep(pending, ps),
        earliest_date: windowStart,
        latest_date: windowEnd,
        reason: `Pathway step ${ps.label ?? ps.work_phase_code}`,
        anchor: anchor.toISOString(),
        stepSeq: pendingIdx,
        isFirstPending: pendingIdx === 0,
        stepStatus: pending.status as 'pending' | 'scheduled',
      });

      anchor = expectedDate;
      pendingIdx++;
    }
    return results;
  }

  // No pathway and no episode_work_phases → default to first consultation
  if (!pathwayWorkPhases || pathwayWorkPhases.length === 0) {
    const anchorDate = completedStats.lastCompletedAt ?? openedAt;
    const { windowStart, windowEnd } = computeStepWindow(anchorDate, DEFAULT_CONSULT_STEP.default_days_offset);
    return [{
      work_phase_code: DEFAULT_CONSULT_STEP.work_phase_code,
      label: DEFAULT_CONSULT_STEP.label,
      pool: DEFAULT_CONSULT_STEP.pool,
      duration_minutes: DEFAULT_CONSULT_STEP.duration_minutes,
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: 'Első konzultáció (nincs pathway)',
      anchor: anchorDate.toISOString(),
      stepSeq: 0,
      isFirstPending: true,
    }];
  }

  // Legacy fallback: no episode_work_phases — use appointment count
  const anchorDate = completedStats.lastCompletedAt ?? openedAt;
  const nextStepIndex = completedStats.completedCount;

  if (currentStage === 'STAGE_0') {
    const consultStep = pathwayWorkPhases.find((s) => s.pool === 'consult');
    if (consultStep) {
      const daysOffset = consultStep.default_days_offset ?? 7;
      const { windowStart, windowEnd } = computeStepWindow(anchorDate, daysOffset);
      return [{
        work_phase_code: consultStep.work_phase_code,
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

  const remaining = pathwayWorkPhases.slice(nextStepIndex);
  if (remaining.length === 0) return [];

  let legacyAnchor = anchorDate;
  const results: PendingStep[] = [];
  for (let i = 0; i < remaining.length; i++) {
    const step = remaining[i];
    const daysOffset = step.default_days_offset ?? 14;
    const { windowStart, windowEnd, expectedDate } = computeStepWindow(legacyAnchor, daysOffset);
    results.push({
      work_phase_code: step.work_phase_code,
      label: step.label,
      pool: slotPoolForStep(step),
      duration_minutes: step.duration_minutes ?? 30,
      earliest_date: windowStart,
      latest_date: windowEnd,
      reason: `Pathway step ${step.label ?? step.work_phase_code}`,
      anchor: legacyAnchor.toISOString(),
      stepSeq: i,
      isFirstPending: i === 0,
    });
    legacyAnchor = expectedDate;
  }
  return results;
}
