import { describe, it, expect } from 'vitest';
import {
  validateTreatmentPlan,
  isPlanApprovable,
  type PlanStepInput,
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

  it('warns on an empty plan', () => {
    expect(codes(validateTreatmentPlan([]))).toContain('EMPTY_PLAN');
  });

  it('treats skipped/cancelled steps as inactive (empty plan)', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'a', status: 'skipped' }),
      step({ workPhaseCode: 'b', status: 'cancelled' }),
    ]);
    expect(codes(issues)).toContain('EMPTY_PLAN');
  });

  it('errors on invalid pool and invalid duration', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'consult_1', pool: 'consult' }),
      step({ workPhaseCode: 'bad', pool: 'nonsense', durationMinutes: 0 }),
    ]);
    expect(codes(issues)).toContain('INVALID_POOL');
    expect(codes(issues)).toContain('INVALID_DURATION');
    expect(isPlanApprovable(issues)).toBe(false);
  });

  it('errors when pool or duration is missing', () => {
    const issues = validateTreatmentPlan([step({ workPhaseCode: 'x', pool: null, durationMinutes: null })]);
    expect(codes(issues)).toContain('INVALID_POOL');
    expect(codes(issues)).toContain('INVALID_DURATION');
  });

  it('warns on a suspiciously long step but does not block', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'consult_1', pool: 'consult' }),
      step({ workPhaseCode: 'marathon', durationMinutes: 600 }),
    ]);
    expect(codes(issues)).toContain('LONG_DURATION');
    expect(isPlanApprovable(issues)).toBe(true);
  });

  it('warns on duplicate steps (once per code, with count in message)', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'consult_1', pool: 'consult' }),
      step({ workPhaseCode: 'work_1' }),
      step({ workPhaseCode: 'work_1' }),
    ]);
    const dup = issues.filter((i) => i.code === 'DUPLICATE_STEP');
    expect(dup).toHaveLength(1);
    expect(dup[0].message).toContain('2×');
  });

  it('warns when work steps exist without any consult', () => {
    const issues = validateTreatmentPlan([step({ workPhaseCode: 'work_1', pool: 'work' })]);
    expect(codes(issues)).toContain('MISSING_CONSULT');
  });

  it('does not warn about missing consult when there is no work either', () => {
    const issues = validateTreatmentPlan([step({ workPhaseCode: 'ctrl', pool: 'control' })]);
    expect(codes(issues)).not.toContain('MISSING_CONSULT');
  });

  it('warns when a control step precedes the first work step', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'consult_1', pool: 'consult' }),
      step({ workPhaseCode: 'early_ctrl', pool: 'control' }),
      step({ workPhaseCode: 'work_1', pool: 'work' }),
    ]);
    expect(codes(issues)).toContain('CONTROL_BEFORE_WORK');
  });

  it('does not warn when controls come after work', () => {
    const issues = validateTreatmentPlan([
      step({ workPhaseCode: 'consult_1', pool: 'consult' }),
      step({ workPhaseCode: 'work_1', pool: 'work' }),
      step({ workPhaseCode: 'work_1_kontroll_1', pool: 'control' }),
    ]);
    expect(codes(issues)).not.toContain('CONTROL_BEFORE_WORK');
  });
});
