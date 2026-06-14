import { describe, it, expect } from 'vitest';
import {
  evaluateIntakePolicy,
  computeBacklogPct,
  AVG_WORK_VISIT_MINUTES,
  INTAKE_STOP_BACKLOG_PCT,
  INTAKE_CAUTION_BACKLOG_PCT,
  type IntakePolicyInput,
} from '@/lib/intake-policy';
import { targetCapacityMinutesForHorizon } from '@/lib/doctor-clinical-target';

const base: IntakePolicyInput = {
  busynessScore: 0,
  backlogPct: 0,
  nearCriticalIfNewStarts: false,
  wipP80DaysFromNow: null,
};

describe('computeBacklogPct', () => {
  it('is 0 when there is no remaining work', () => {
    expect(computeBacklogPct(0, 1, 30)).toBe(0);
  });

  it('scales remaining visits to capacity (1 doctor)', () => {
    const cap = targetCapacityMinutesForHorizon(30); // monthly capacity in minutes
    const visits = 10;
    const expected = Math.round(((visits * AVG_WORK_VISIT_MINUTES) / cap) * 100);
    expect(computeBacklogPct(visits, 1, 30)).toBe(expected);
  });

  it('divides by doctor count (team capacity)', () => {
    const single = computeBacklogPct(20, 1, 30);
    const team = computeBacklogPct(20, 2, 30);
    expect(team).toBe(Math.round(single / 2));
  });

  it('is 0 with zero doctors (graceful, no divide-by-zero)', () => {
    expect(computeBacklogPct(50, 0, 30)).toBe(0);
  });
});

describe('evaluateIntakePolicy — calendar busyness (unchanged behavior)', () => {
  it('GO when nothing is loaded', () => {
    expect(evaluateIntakePolicy(base)).toEqual({ recommendation: 'GO', reasons: ['OK'] });
  });

  it('STOP at >=200% busyness', () => {
    const r = evaluateIntakePolicy({ ...base, busynessScore: 210 });
    expect(r.recommendation).toBe('STOP');
    expect(r.reasons).toContain('BUSYNESS_210');
  });

  it('CAUTION at 150–199% busyness', () => {
    const r = evaluateIntakePolicy({ ...base, busynessScore: 160 });
    expect(r.recommendation).toBe('CAUTION');
    expect(r.reasons).toContain('BUSYNESS_160');
  });

  it('STOP when no free slot but open work', () => {
    const r = evaluateIntakePolicy({ ...base, nearCriticalIfNewStarts: true });
    expect(r.recommendation).toBe('STOP');
    expect(r.reasons).toContain('NEAR_CRITICAL_IF_NEW_STARTS');
  });

  it('WIP horizon drives STOP (>28d) and CAUTION (>14d)', () => {
    expect(evaluateIntakePolicy({ ...base, wipP80DaysFromNow: 40 }).recommendation).toBe('STOP');
    expect(evaluateIntakePolicy({ ...base, wipP80DaysFromNow: 20 }).recommendation).toBe('CAUTION');
    expect(evaluateIntakePolicy({ ...base, wipP80DaysFromNow: 10 }).recommendation).toBe('GO');
  });
});

describe('evaluateIntakePolicy — backlog (the new Gap-B signal)', () => {
  it('STOP when hidden backlog is high even if the calendar is empty', () => {
    const r = evaluateIntakePolicy({ ...base, busynessScore: 0, backlogPct: INTAKE_STOP_BACKLOG_PCT });
    expect(r.recommendation).toBe('STOP');
    expect(r.reasons).toContain(`BACKLOG_${INTAKE_STOP_BACKLOG_PCT}`);
  });

  it('CAUTION when backlog is moderate even with an empty calendar', () => {
    const r = evaluateIntakePolicy({ ...base, backlogPct: INTAKE_CAUTION_BACKLOG_PCT });
    expect(r.recommendation).toBe('CAUTION');
    expect(r.reasons).toContain(`BACKLOG_${INTAKE_CAUTION_BACKLOG_PCT}`);
  });

  it('does not affect the decision when backlog is low', () => {
    expect(evaluateIntakePolicy({ ...base, backlogPct: 50 }).recommendation).toBe('GO');
  });

  it('takes the stricter factor: backlog STOP overrides busyness CAUTION', () => {
    const r = evaluateIntakePolicy({ ...base, busynessScore: 160, backlogPct: 320 });
    expect(r.recommendation).toBe('STOP');
    expect(r.reasons).toContain('BACKLOG_320');
    // busyness was only caution-level, so it is not listed among STOP reasons
    expect(r.reasons).not.toContain('BUSYNESS_160');
  });

  it('lists multiple reasons when several factors trip together', () => {
    const r = evaluateIntakePolicy({ ...base, busynessScore: 220, backlogPct: 350 });
    expect(r.recommendation).toBe('STOP');
    expect(r.reasons).toEqual(expect.arrayContaining(['BUSYNESS_220', 'BACKLOG_350']));
  });
});
