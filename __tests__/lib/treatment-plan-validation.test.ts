import { describe, it, expect } from 'vitest';
import {
  validateTreatmentPlan,
  isPlanApprovable,
  hasActivePlanSteps,
  summarizePlanReadiness,
  aggregatePlanReadiness,
  LONG_DURATION_MINUTES,
  type PlanStepInput,
  type PlanIssue,
} from '@/lib/treatment-plan-validation';

const step = (over: Partial<PlanStepInput> & { workPhaseCode: string }): PlanStepInput => ({
  pool: 'work',
  durationMinutes: 30,
  status: 'pending',
  ...over,
});

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('validateTreatmentPlan', () => {
  it('returns no issues for a clean plan', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'consult_1', pool: 'consult' }),
      step({ workPhaseCode: 'work_1', pool: 'work' }),
      step({ workPhaseCode: 'work_1_kontroll_1', pool: 'control' }),
    ]);
    expect(issues).toEqual([]);
    expect(isPlanApprovable(issues)).toBe(true);
  });

  it('errors on invalid pool and invalid duration', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'consult_1', pool: 'consult' }),
      step({ workPhaseCode: 'bad', pool: 'nonsense', durationMinutes: 0 }),
    ]);
    expect(codes(issues)).toContain('INVALID_POOL');
    expect(codes(issues)).toContain('INVALID_DURATION');
    expect(issues.every((i) => i.level === 'error')).toBe(true);
    expect(isPlanApprovable(issues)).toBe(false);
  });

  it('errors when pool or duration is missing', () => {
    const issues = validateTreatmentPlan([step({ workPhaseCode: 'x', pool: null, durationMinutes: null })]);
    expect(codes(issues)).toContain('INVALID_POOL');
    expect(codes(issues)).toContain('INVALID_DURATION');
  });

  it('does not check skipped/cancelled steps (they will not be booked)', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'ok', pool: 'work' }),
      step({ workPhaseCode: 'broken', pool: null, durationMinutes: null, status: 'skipped' }),
      step({ workPhaseCode: 'gone', pool: 'nonsense', durationMinutes: 0, status: 'cancelled' }),
    ]);
    expect(issues).toEqual([]);
  });

  // ── WP-1.1: kivezetett warning-szabályok — ezek az esetek tiszták ─────────

  it('an empty plan produces no issues (the empty state is the plan card, not a badge)', () => {
    const issues = validateTreatmentPlan([]);
    expect(issues).toEqual([]);
    expect(isPlanApprovable(issues)).toBe(true);
  });

  it('a plan with only skipped/cancelled steps produces no issues', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'a', status: 'skipped' }),
      step({ workPhaseCode: 'b', status: 'cancelled' }),
    ]);
    expect(issues).toEqual([]);
  });

  it('repeated phases produce no issues (ugyanaz a fázis többször = több alkalom)', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'lenyomat' }),
      step({ workPhaseCode: 'lenyomat' }),
      step({ workPhaseCode: 'lenyomat' }),
    ]);
    expect(issues).toEqual([]);
    expect(isPlanApprovable(issues)).toBe(true);
  });

  it('a work-only plan without consult produces no issues', () => {
    expect(validateTreatmentPlan([step({ workPhaseCode: 'work_1', pool: 'work' })])).toEqual([]);
  });

  it('a control step before the first work step produces no issues', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'early_ctrl', pool: 'control' }),
      step({ workPhaseCode: 'work_1', pool: 'work' }),
    ]);
    expect(issues).toEqual([]);
  });

  it('a long step produces no issue (a hosszú időtartam a szerkesztő sor inline hintje)', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'marathon', durationMinutes: LONG_DURATION_MINUTES + 300 }),
    ]);
    expect(issues).toEqual([]);
    expect(isPlanApprovable(issues)).toBe(true);
  });
});

describe('hasActivePlanSteps', () => {
  it('false for an empty plan and for all-skipped/cancelled plans', () => {
    expect(hasActivePlanSteps([])).toBe(false);
    expect(
      hasActivePlanSteps([
        step({ workPhaseCode: 'a', status: 'skipped' }),
        step({ workPhaseCode: 'b', status: 'cancelled' }),
      ])
    ).toBe(false);
  });

  it('true when any pending/scheduled/completed step exists', () => {
    expect(hasActivePlanSteps([step({ workPhaseCode: 'a', status: 'completed' })])).toBe(true);
    expect(
      hasActivePlanSteps([
        step({ workPhaseCode: 'a', status: 'skipped' }),
        step({ workPhaseCode: 'b', status: 'pending' }),
      ])
    ).toBe(true);
  });
});

describe('summarizePlanReadiness', () => {
  const err: PlanIssue = { level: 'error', code: 'INVALID_POOL', message: '' };

  it('returns "ready" for a clean, unapproved plan', () => {
    expect(summarizePlanReadiness([], false)).toBe('ready');
  });

  it('returns "approved" when approved and no errors', () => {
    expect(summarizePlanReadiness([], true)).toBe('approved');
  });

  it('errors win even over an existing approval', () => {
    expect(summarizePlanReadiness([err], true)).toBe('errors');
    expect(summarizePlanReadiness([err], false)).toBe('errors');
  });
});

describe('aggregatePlanReadiness', () => {
  it('returns null for no episodes', () => {
    expect(aggregatePlanReadiness([])).toBeNull();
  });

  it('errors win over everything', () => {
    expect(aggregatePlanReadiness(['ready', 'errors', 'approved'])).toBe('errors');
  });

  it('approved only when all are approved', () => {
    expect(aggregatePlanReadiness(['approved', 'approved'])).toBe('approved');
    expect(aggregatePlanReadiness(['approved', 'ready'])).toBe('ready');
  });
});
