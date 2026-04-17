import { describe, it, expect } from 'vitest';
import { isToothTreatmentPathwayDone } from '@/lib/tooth-treatment-pathway';

describe('isToothTreatmentPathwayDone', () => {
  it('is true when status is completed', () => {
    expect(isToothTreatmentPathwayDone({ status: 'completed' })).toBe(true);
    expect(isToothTreatmentPathwayDone({ status: 'completed', pathwayClosed: false })).toBe(true);
  });

  it('is true when pathwayClosed even if episode_linked', () => {
    expect(isToothTreatmentPathwayDone({ status: 'episode_linked', pathwayClosed: true })).toBe(true);
  });

  it('is false for pending or open episode_linked', () => {
    expect(isToothTreatmentPathwayDone({ status: 'pending' })).toBe(false);
    expect(isToothTreatmentPathwayDone({ status: 'episode_linked' })).toBe(false);
    expect(isToothTreatmentPathwayDone({ status: 'episode_linked', pathwayClosed: false })).toBe(false);
  });
});
