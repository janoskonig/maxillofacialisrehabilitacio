import { describe, expect, it, vi } from 'vitest';
import {
  normalizePathwayWorkPhaseArray,
  pathwayTemplatesFromCarePathwayRow,
  dedupePathwayWorkPhases,
  type PathwayWorkPhaseTemplate,
} from '@/lib/pathway-work-phases-for-episode';

const tpl = (over: Partial<PathwayWorkPhaseTemplate> & { work_phase_code: string }): PathwayWorkPhaseTemplate => ({
  pool: 'work',
  duration_minutes: 30,
  default_days_offset: 7,
  ...over,
});

describe('pathwayTemplatesFromCarePathwayRow', () => {
  it('falls back to steps_json when work_phases_json is an empty array', () => {
    const row = {
      work_phases_json: [],
      steps_json: [{ step_code: 'legacy_only', pool: 'work', duration_minutes: 30, default_days_offset: 0 }],
    };
    const got = pathwayTemplatesFromCarePathwayRow(row);
    expect(got).not.toBeNull();
    expect(got!.map((t) => t.work_phase_code)).toEqual(['legacy_only']);
  });

  it('prefers non-empty work_phases_json over steps_json', () => {
    const row = {
      work_phases_json: [{ work_phase_code: 'canonical', pool: 'work', duration_minutes: 20, default_days_offset: 1 }],
      steps_json: [{ step_code: 'legacy', pool: 'work', duration_minutes: 30, default_days_offset: 0 }],
    };
    const got = pathwayTemplatesFromCarePathwayRow(row);
    expect(got!.map((t) => t.work_phase_code)).toEqual(['canonical']);
  });

  it('documents why raw ?? merge is unsafe: empty array does not trigger ??', () => {
    const row = {
      work_phases_json: [],
      steps_json: [{ step_code: 'from_legacy', pool: 'consult', duration_minutes: 30, default_days_offset: 0 }],
    };
    const wrong = normalizePathwayWorkPhaseArray(row.work_phases_json ?? row.steps_json);
    expect(wrong).toBeNull();
    const right = pathwayTemplatesFromCarePathwayRow(row);
    expect(right).not.toBeNull();
  });
});

describe('dedupePathwayWorkPhases', () => {
  it('keeps order and removes identical duplicates (first wins)', () => {
    const merged = [tpl({ work_phase_code: 'a' }), tpl({ work_phase_code: 'b' }), tpl({ work_phase_code: 'a' })];
    const got = dedupePathwayWorkPhases(merged);
    expect(got.map((t) => t.work_phase_code)).toEqual(['a', 'b']);
  });

  it('keeps the first occurrence and drops a conflicting duplicate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const merged = [
      tpl({ work_phase_code: 'impl', duration_minutes: 60 }),
      tpl({ work_phase_code: 'impl', duration_minutes: 90 }),
    ];
    const got = dedupePathwayWorkPhases(merged);
    expect(got).toHaveLength(1);
    expect(got[0].duration_minutes).toBe(60); // first wins
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('does not warn for identical duplicates', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dedupePathwayWorkPhases([tpl({ work_phase_code: 'x' }), tpl({ work_phase_code: 'x' })]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('leaves distinct codes untouched', () => {
    const merged = [tpl({ work_phase_code: 'a' }), tpl({ work_phase_code: 'b' }), tpl({ work_phase_code: 'c' })];
    expect(dedupePathwayWorkPhases(merged).map((t) => t.work_phase_code)).toEqual(['a', 'b', 'c']);
  });
});
