/**
 * Treatment plan validation — pure, DB-free rules over an episode's work phases.
 *
 * WP3: until now a plan could be assembled in clinically inconsistent ways with no
 * feedback (ad-hoc free-text steps with no pool/duration, duplicate steps, controls
 * before any work, empty plans). `validateTreatmentPlan` surfaces those as
 * structured issues so the UI can block on errors and warn on the rest, and so a
 * plan can be explicitly marked "approved / ready to book".
 *
 * Levels:
 *  - 'error'   → structurally invalid; the plan should not be considered ready.
 *  - 'warning' → clinically suspicious but allowed; needs human confirmation.
 */

export type PlanIssueLevel = 'error' | 'warning';

export interface PlanIssue {
  level: PlanIssueLevel;
  code: string;
  message: string;
  /** The offending step, when the issue is step-scoped. */
  workPhaseCode?: string;
}

export type PlanStepStatus = 'pending' | 'scheduled' | 'completed' | 'skipped' | 'cancelled';

export interface PlanStepInput {
  workPhaseCode: string;
  /** Effective pool; anything outside the canonical set is treated as invalid. */
  pool: string | null;
  durationMinutes: number | null;
  status: PlanStepStatus | string;
  label?: string | null;
}

const CANONICAL_POOLS = new Set(['consult', 'work', 'control']);

/** Steps that still count as part of the active plan (not skipped/cancelled). */
const ACTIVE_STATUSES = new Set(['pending', 'scheduled', 'completed']);

/** Per-step duration above this (minutes) is suspicious for a single appointment. */
export const LONG_DURATION_MINUTES = 300;

function isActive(step: PlanStepInput): boolean {
  return ACTIVE_STATUSES.has(step.status);
}

/**
 * Validate a treatment plan (ordered list of work phases, in scheduling order).
 * Returns an ordered list of issues; an empty array means the plan is clean.
 */
export function validateTreatmentPlan(steps: PlanStepInput[]): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const active = steps.filter(isActive);

  // Empty plan.
  if (active.length === 0) {
    issues.push({
      level: 'warning',
      code: 'EMPTY_PLAN',
      message: 'A kezelési terv üres (nincs aktív lépés).',
    });
  }

  // Structural validity: pool + duration. (Checked over active steps only —
  // skipped/cancelled steps are not going to be booked.)
  for (const step of active) {
    if (!step.pool || !CANONICAL_POOLS.has(step.pool)) {
      issues.push({
        level: 'error',
        code: 'INVALID_POOL',
        message: `A(z) "${step.label ?? step.workPhaseCode}" lépésnek érvénytelen vagy hiányzó típusa (pool): ${step.pool ?? '—'}.`,
        workPhaseCode: step.workPhaseCode,
      });
    }
    if (step.durationMinutes == null || step.durationMinutes <= 0) {
      issues.push({
        level: 'error',
        code: 'INVALID_DURATION',
        message: `A(z) "${step.label ?? step.workPhaseCode}" lépésnek hiányzik vagy érvénytelen az időtartama.`,
        workPhaseCode: step.workPhaseCode,
      });
    } else if (step.durationMinutes > LONG_DURATION_MINUTES) {
      issues.push({
        level: 'warning',
        code: 'LONG_DURATION',
        message: `A(z) "${step.label ?? step.workPhaseCode}" lépés szokatlanul hosszú (${step.durationMinutes} perc).`,
        workPhaseCode: step.workPhaseCode,
      });
    }
  }

  // Duplicate work_phase_code among active steps.
  const counts = new Map<string, number>();
  for (const step of active) {
    counts.set(step.workPhaseCode, (counts.get(step.workPhaseCode) ?? 0) + 1);
  }
  for (const [code, count] of Array.from(counts)) {
    if (count > 1) {
      issues.push({
        level: 'warning',
        code: 'DUPLICATE_STEP',
        message: `A(z) "${code}" lépés ${count}× szerepel a tervben.`,
        workPhaseCode: code,
      });
    }
  }

  // Missing consultation step anywhere in the plan.
  const hasConsult = active.some((s) => s.pool === 'consult');
  const hasWork = active.some((s) => s.pool === 'work');
  if (!hasConsult && hasWork) {
    issues.push({
      level: 'warning',
      code: 'MISSING_CONSULT',
      message: 'A terv munkafázist tartalmaz konzultációs lépés nélkül.',
    });
  }

  // Control step before the first work step (in scheduling order).
  const firstWorkIdx = active.findIndex((s) => s.pool === 'work');
  if (firstWorkIdx > 0) {
    for (let i = 0; i < firstWorkIdx; i++) {
      if (active[i].pool === 'control') {
        issues.push({
          level: 'warning',
          code: 'CONTROL_BEFORE_WORK',
          message: `A(z) "${active[i].label ?? active[i].workPhaseCode}" kontroll lépés munkafázis előtt szerepel.`,
          workPhaseCode: active[i].workPhaseCode,
        });
      }
    }
  }

  return issues;
}

/** Convenience: a plan is "ready to book/approve" when it has no error-level issues. */
export function isPlanApprovable(issues: PlanIssue[]): boolean {
  return !issues.some((i) => i.level === 'error');
}

/**
 * Compact readiness state for list views (Gantt rows, worklist) — one badge per
 * episode. Errors win over an existing approval, so a plan edited into an invalid
 * state after approval shows red rather than a misleading green check.
 */
export type PlanReadinessStatus = 'errors' | 'approved' | 'warnings' | 'ready';

export function summarizePlanReadiness(issues: PlanIssue[], approved: boolean): PlanReadinessStatus {
  if (issues.some((i) => i.level === 'error')) return 'errors';
  if (approved) return 'approved';
  if (issues.some((i) => i.level === 'warning')) return 'warnings';
  return 'ready';
}
