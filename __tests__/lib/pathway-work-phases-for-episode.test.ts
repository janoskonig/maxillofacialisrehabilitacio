import { describe, expect, it } from 'vitest';
import {
  normalizePathwayWorkPhaseArray,
  pathwayTemplatesFromCarePathwayRow,
} from '@/lib/pathway-work-phases-for-episode';

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
