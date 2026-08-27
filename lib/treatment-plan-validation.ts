/**
 * Treatment plan validation — pure, DB-free rules over an episode's work phases.
 *
 * WP-1.1 (zajcsökkentés): a korábbi warning-szabályok kivezetve, mert hamis
 * riasztást adtak, és a vizit-alapú terv modellje ellen dolgoztak:
 *  - MISSING_CONSULT — konzultáció nem kell minden tervbe;
 *  - DUPLICATE_STEP — ugyanaz a fázis többször = legitim „több alkalom"
 *    (kétállcsontos tervnél ma is hamis riasztás volt);
 *  - CONTROL_BEFORE_WORK — ugyanez az ok;
 *  - EMPTY_PLAN — az üres terv jelzése a terv-kártya üres-állapota, nem badge;
 *  - LONG_DURATION — a szokatlanul hosszú időtartam inline hint a szerkesztő
 *    sorban (TimingEditor, `LONG_DURATION_MINUTES` alapján), nem badge és nem
 *    összesítő.
 *
 * Ami maradt, az a két strukturális error: érvénytelen/hiányzó pool és
 * időtartam — ezek nélkül a lépés tényleg nem foglalható.
 */

export type PlanIssueLevel = 'error';

export type PlanIssueCode = 'INVALID_POOL' | 'INVALID_DURATION';

export interface PlanIssue {
  level: PlanIssueLevel;
  code: PlanIssueCode;
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

/**
 * Per-step duration above this (minutes) is unusual for a single appointment.
 * Nem validációs szabály — a szerkesztő sor (TimingEditor) inline hintje
 * használja.
 */
export const LONG_DURATION_MINUTES = 300;

function isActive(step: PlanStepInput): boolean {
  return ACTIVE_STATUSES.has(step.status);
}

/**
 * Van-e a tervben aktív (nem kihagyott/lemondott) lépés? Az üres terv nem
 * validációs issue — a hívó ennek alapján mutat üres-állapotot (kártya) vagy
 * hagyja el a readiness badge-et (listák).
 */
export function hasActivePlanSteps(steps: PlanStepInput[]): boolean {
  return steps.some(isActive);
}

/**
 * Validate a treatment plan (ordered list of work phases, in scheduling order).
 * Returns an ordered list of issues; an empty array means the plan is bookable.
 * Csak error-szintű, strukturális hibákat ad — klinikai ízlés-szabályt nem.
 */
export function validateTreatmentPlan(steps: PlanStepInput[]): PlanIssue[] {
  const issues: PlanIssue[] = [];

  // Structural validity: pool + duration. (Checked over active steps only —
  // skipped/cancelled steps are not going to be booked.)
  for (const step of steps.filter(isActive)) {
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
 * WP-1.1: warning-szint nincs többé — errors | approved | ready.
 */
export type PlanReadinessStatus = 'errors' | 'approved' | 'ready';

export function summarizePlanReadiness(issues: PlanIssue[], approved: boolean): PlanReadinessStatus {
  if (issues.some((i) => i.level === 'error')) return 'errors';
  if (approved) return 'approved';
  return 'ready';
}

/**
 * Aggregate several episodes' readiness into one row-level badge (a patient row in
 * the Gantt may span multiple episodes). Worst state wins; "approved" only when all
 * are approved. Returns null when there is nothing to show.
 */
export function aggregatePlanReadiness(statuses: PlanReadinessStatus[]): PlanReadinessStatus | null {
  if (statuses.length === 0) return null;
  if (statuses.includes('errors')) return 'errors';
  if (statuses.every((s) => s === 'approved')) return 'approved';
  return 'ready';
}
