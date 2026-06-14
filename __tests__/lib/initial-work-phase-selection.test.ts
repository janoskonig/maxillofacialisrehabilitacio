import { describe, it, expect } from 'vitest';
import {
  selectInitialWorkPhasesFromSteps,
  selectInitialWorkPhasesFromPathway,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_DAYS_OFFSET,
  type EpisodeWorkPhaseLite,
  type PathwayPhaseLite,
} from '@/lib/initial-work-phase-selection';

const ewp = (over: Partial<EpisodeWorkPhaseLite> & { workPhaseCode: string; pathwayOrderIndex: number }): EpisodeWorkPhaseLite => ({
  pool: 'work',
  durationMinutes: 60,
  defaultDaysOffset: 7,
  status: 'pending',
  ...over,
});

const tpl = (over: Partial<PathwayPhaseLite> & { work_phase_code: string }): PathwayPhaseLite => ({
  pool: 'work',
  duration_minutes: 60,
  default_days_offset: 7,
  ...over,
});

describe('selectInitialWorkPhasesFromSteps — curated plan (SSOT, skip-aware)', () => {
  it('picks the next pending work steps in order', () => {
    const got = selectInitialWorkPhasesFromSteps(
      [
        ewp({ workPhaseCode: 'consult_1', pool: 'consult', pathwayOrderIndex: 0 }),
        ewp({ workPhaseCode: 'work_1', pathwayOrderIndex: 1 }),
        ewp({ workPhaseCode: 'work_2', pathwayOrderIndex: 2 }),
        ewp({ workPhaseCode: 'work_3', pathwayOrderIndex: 3 }),
      ],
      2
    );
    expect(got.map((p) => p.workPhaseCode)).toEqual(['work_1', 'work_2']);
    expect(got[0].stepSeq).toBe(1); // pathwayOrderIndex, not array index
  });

  it('skips completed, scheduled and skipped steps', () => {
    const got = selectInitialWorkPhasesFromSteps(
      [
        ewp({ workPhaseCode: 'work_1', status: 'completed', pathwayOrderIndex: 0 }),
        ewp({ workPhaseCode: 'work_2', status: 'skipped', pathwayOrderIndex: 1 }),
        ewp({ workPhaseCode: 'work_3', status: 'scheduled', pathwayOrderIndex: 2 }),
        ewp({ workPhaseCode: 'work_4', status: 'pending', pathwayOrderIndex: 3 }),
      ],
      2
    );
    expect(got.map((p) => p.workPhaseCode)).toEqual(['work_4']);
  });

  it('ignores non-work pools', () => {
    const got = selectInitialWorkPhasesFromSteps(
      [
        ewp({ workPhaseCode: 'consult_1', pool: 'consult', pathwayOrderIndex: 0 }),
        ewp({ workPhaseCode: 'ctrl_1', pool: 'control', pathwayOrderIndex: 1 }),
        ewp({ workPhaseCode: 'work_1', pathwayOrderIndex: 2 }),
      ],
      2
    );
    expect(got.map((p) => p.workPhaseCode)).toEqual(['work_1']);
  });

  it('falls back to defaults for missing duration/offset', () => {
    const got = selectInitialWorkPhasesFromSteps(
      [ewp({ workPhaseCode: 'work_1', durationMinutes: null, defaultDaysOffset: null, pathwayOrderIndex: 0 })],
      1
    );
    expect(got[0].durationMinutes).toBe(DEFAULT_DURATION_MINUTES);
    expect(got[0].defaultDaysOffset).toBe(DEFAULT_DAYS_OFFSET);
  });
});

describe('selectInitialWorkPhasesFromPathway — fallback (count-based)', () => {
  it('starts after the completed count and takes work-pool phases', () => {
    const got = selectInitialWorkPhasesFromPathway(
      [
        tpl({ work_phase_code: 'consult_1', pool: 'consult' }),
        tpl({ work_phase_code: 'work_1' }),
        tpl({ work_phase_code: 'work_2' }),
        tpl({ work_phase_code: 'work_3' }),
      ],
      1, // consult done
      2
    );
    expect(got.map((p) => p.workPhaseCode)).toEqual(['work_1', 'work_2']);
    expect(got[0].stepSeq).toBe(1);
  });

  it('returns nothing when past the end', () => {
    const got = selectInitialWorkPhasesFromPathway([tpl({ work_phase_code: 'work_1' })], 5, 2);
    expect(got).toEqual([]);
  });

  it('handles a negative/zero completed count safely', () => {
    const got = selectInitialWorkPhasesFromPathway([tpl({ work_phase_code: 'work_1' })], -3, 2);
    expect(got.map((p) => p.workPhaseCode)).toEqual(['work_1']);
  });
});
