import { describe, it, expect } from 'vitest';
import {
  projectRemainingVisits,
  computeCompletionWindow,
  DEFAULT_CADENCE_DAYS,
  type VisitProjectionInput,
} from '@/lib/episode-forecast-projection';

const base: VisitProjectionInput = {
  hasCarePathway: true,
  medianVisits: null,
  p80Visits: null,
  medianCadenceDays: null,
  completedVisits: 0,
  remainingSteps: null,
  totalWorkSteps: null,
};

describe('projectRemainingVisits — calibrated analytics (progress-adjusted)', () => {
  it('subtracts completed visits from the calibrated total', () => {
    const fresh = projectRemainingVisits({ ...base, medianVisits: 10, p80Visits: 14, completedVisits: 0 });
    expect(fresh.remainingVisitsP50).toBe(10);
    expect(fresh.remainingVisitsP80).toBe(14);

    const halfway = projectRemainingVisits({ ...base, medianVisits: 10, p80Visits: 14, completedVisits: 6 });
    expect(halfway.remainingVisitsP50).toBe(4); // 10 - 6
    expect(halfway.remainingVisitsP80).toBe(8); // 14 - 6
    expect(halfway.assumptions).toContain('PROGRESS_ADJUSTED');
    expect(halfway.assumptions).toContain('calibrated-pathway');
  });

  it('progresses toward completion: more completed → fewer remaining', () => {
    const early = projectRemainingVisits({ ...base, medianVisits: 10, p80Visits: 12, completedVisits: 2 });
    const late = projectRemainingVisits({ ...base, medianVisits: 10, p80Visits: 12, completedVisits: 8 });
    expect(late.remainingVisitsP50).toBeLessThan(early.remainingVisitsP50);
  });

  it('clamps remaining to at least 1 even when over-completed', () => {
    const over = projectRemainingVisits({ ...base, medianVisits: 10, p80Visits: 12, completedVisits: 20 });
    expect(over.remainingVisitsP50).toBe(1);
    expect(over.remainingVisitsP80).toBeGreaterThanOrEqual(over.remainingVisitsP50);
  });

  it('uses analytics cadence when present, defaults otherwise', () => {
    const withCadence = projectRemainingVisits({ ...base, medianVisits: 5, p80Visits: 7, medianCadenceDays: 21 });
    expect(withCadence.cadenceDays).toBe(21);
    expect(withCadence.assumptions).toContain('cadence-from-analytics');

    const noCadence = projectRemainingVisits({ ...base, medianVisits: 5, p80Visits: 7, medianCadenceDays: null });
    expect(noCadence.cadenceDays).toBe(DEFAULT_CADENCE_DAYS);
    expect(noCadence.assumptions).toContain('CADENCE_DEFAULTED');
  });
});

describe('projectRemainingVisits — concrete remaining steps', () => {
  it('uses the remaining-step count when no analytics exist', () => {
    const proj = projectRemainingVisits({ ...base, remainingSteps: 5 });
    expect(proj.remainingVisitsP50).toBe(5);
    expect(proj.remainingVisitsP80).toBe(Math.ceil(5 * 1.3)); // 7
    expect(proj.assumptions).toContain('EPISODE_STEPS_REMAINING');
  });

  it('treats 0 remaining steps as 1 (clamped)', () => {
    const proj = projectRemainingVisits({ ...base, remainingSteps: 0 });
    expect(proj.remainingVisitsP50).toBe(1);
  });

  it('analytics take priority over remaining steps when both present', () => {
    const proj = projectRemainingVisits({ ...base, medianVisits: 8, p80Visits: 10, remainingSteps: 3 });
    expect(proj.assumptions).toContain('calibrated-pathway');
    expect(proj.remainingVisitsP50).toBe(8);
  });
});

describe('projectRemainingVisits — pathway heuristic (progress-adjusted)', () => {
  it('applies the work-step ratio and subtracts completed visits', () => {
    // workSteps=10 → P50 ceil(10*0.6)=6, P80 ceil(10*0.9)=9; minus 2 completed
    const proj = projectRemainingVisits({ ...base, totalWorkSteps: 10, completedVisits: 2, remainingSteps: null });
    expect(proj.remainingVisitsP50).toBe(4);
    expect(proj.remainingVisitsP80).toBe(7);
    expect(proj.assumptions).toContain('NO_ANALYTICS_FALLBACK');
    expect(proj.assumptions).toContain('PROGRESS_ADJUSTED');
  });

  it('defaults work-step count to 4 when unknown', () => {
    const proj = projectRemainingVisits({ ...base, totalWorkSteps: null, remainingSteps: null });
    expect(proj.remainingVisitsP50).toBe(Math.ceil(4 * 0.6)); // 3
  });
});

describe('projectRemainingVisits — no pathway', () => {
  it('returns coarse defaults', () => {
    const proj = projectRemainingVisits({ ...base, hasCarePathway: false, remainingSteps: null });
    expect(proj.remainingVisitsP50).toBe(4);
    expect(proj.remainingVisitsP80).toBe(6);
    expect(proj.assumptions).toContain('NO_CARE_PATHWAY_DEFAULT');
  });
});

describe('computeCompletionWindow', () => {
  it('shifts the next-step window by remaining visits × cadence', () => {
    const earliest = new Date('2026-01-01T00:00:00.000Z');
    const latest = new Date('2026-01-08T00:00:00.000Z');
    const { start, end } = computeCompletionWindow(earliest, latest, {
      remainingVisitsP50: 3,
      remainingVisitsP80: 5,
      cadenceDays: 14,
    });
    // start = 2026-01-01 + 42 days, end = 2026-01-08 + 70 days
    expect(start.toISOString().slice(0, 10)).toBe('2026-02-12');
    expect(end.toISOString().slice(0, 10)).toBe('2026-03-19');
  });

  it('does not mutate the input dates', () => {
    const earliest = new Date('2026-01-01T00:00:00.000Z');
    const latest = new Date('2026-01-01T00:00:00.000Z');
    computeCompletionWindow(earliest, latest, { remainingVisitsP50: 2, remainingVisitsP80: 2, cadenceDays: 7 });
    expect(earliest.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(latest.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});
