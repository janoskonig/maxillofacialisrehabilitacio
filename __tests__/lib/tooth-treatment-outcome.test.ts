import { describe, it, expect } from 'vitest';
import {
  applyTreatmentOutcome,
  outcomeBaseFor,
  projectFogakWithTreatments,
} from '@/lib/tooth-treatment-outcome';

describe('outcomeBaseFor', () => {
  it('maps the clinical treatment codes to their resulting base', () => {
    expect(outcomeBaseFor('huzas')).toBe('missing');
    expect(outcomeBaseFor('implantacio')).toBe('implant');
    expect(outcomeBaseFor('korona')).toBe('crown');
    expect(outcomeBaseFor('tomes')).toBe('filled');
    expect(outcomeBaseFor('gyokerkezeles')).toBe('root_canal');
    expect(outcomeBaseFor('hid_pillerkezeles')).toBe('bridge_abutment');
  });

  it('returns null for codes without an automatic status change', () => {
    expect(outcomeBaseFor('csiszolas')).toBeNull();
    expect(outcomeBaseFor('nem_letezik')).toBeNull();
  });
});

describe('applyTreatmentOutcome', () => {
  it('extraction makes the tooth missing and clears caries/periapical/mobility', () => {
    const { changed, next } = applyTreatmentOutcome(
      { base: 'sound', caries: true, periapical: true, mobility: 2 },
      'huzas',
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ base: 'missing' });
  });

  it('filling a carious tooth becomes filled and clears caries', () => {
    const { changed, next } = applyTreatmentOutcome({ base: 'sound', caries: true }, 'tomes');
    expect(changed).toBe(true);
    expect(next).toEqual({ base: 'filled' });
  });

  it('root canal keeps existing caries but clears periapical', () => {
    const { next } = applyTreatmentOutcome(
      { base: 'sound', caries: true, periapical: true },
      'gyokerkezeles',
    );
    expect(next).toEqual({ base: 'root_canal', caries: true });
  });

  it('resolves the legacy D/F/M status shape before applying', () => {
    const { changed, next } = applyTreatmentOutcome({ status: 'D' }, 'tomes');
    expect(changed).toBe(true);
    expect(next).toEqual({ base: 'filled' });
  });

  it('csiszolás and unknown codes leave the tooth unchanged', () => {
    expect(applyTreatmentOutcome({ base: 'crown' }, 'csiszolas').changed).toBe(false);
    expect(applyTreatmentOutcome({ base: 'crown' }, 'whatever').changed).toBe(false);
  });

  it('reports no change when the result already matches', () => {
    expect(applyTreatmentOutcome({ base: 'missing' }, 'huzas').changed).toBe(false);
  });
});

describe('projectFogakWithTreatments', () => {
  it('applies every planned treatment without mutating the input', () => {
    const input = { '11': { base: 'sound', caries: true }, '21': { base: 'sound' } };
    const out = projectFogakWithTreatments(input, [
      { toothNumber: 11, treatmentCode: 'tomes' },
      { toothNumber: '21', treatmentCode: 'huzas' },
    ]);
    expect(out).toEqual({ '11': { base: 'filled' }, '21': { base: 'missing' } });
    // input untouched
    expect(input['11']).toEqual({ base: 'sound', caries: true });
  });
});
