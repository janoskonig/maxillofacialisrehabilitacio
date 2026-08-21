import { describe, expect, it } from 'vitest';
import {
  isPatientAdditionalFilter,
  isPatientQuickView,
  isPatientScope,
} from '@/lib/patient-list-filters';

describe('patient-list-filters', () => {
  it('csak az ismert betegköröket fogadja el', () => {
    expect(isPatientScope('all')).toBe(true);
    expect(isPatientScope('mine')).toBe(true);
    expect(isPatientScope('someone-else')).toBe(false);
  });

  it('csak az ismert gyorsnézeteket fogadja el', () => {
    expect(isPatientQuickView('preparatory')).toBe(true);
    expect(isPatientQuickView('prosthetic')).toBe(true);
    expect(isPatientQuickView('STAGE_5')).toBe(false);
  });

  it('az ismeretlen további szűrőket elutasítja', () => {
    expect(isPatientAdditionalFilter('missing_data')).toBe(true);
    expect(isPatientAdditionalFilter('no_next_appointment')).toBe(true);
    expect(isPatientAdditionalFilter('next_consilium')).toBe(true);
    expect(isPatientAdditionalFilter('arbitrary_sql')).toBe(false);
  });
});
