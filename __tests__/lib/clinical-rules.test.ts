import { describe, it, expect } from 'vitest';
import {
  getChecklistStatus,
  isHardRequiredField,
  isRecommendedField,
  HARD_REQUIRED_FIELDS,
  RECOMMENDED_FIELDS,
  PROTOCOL_VERSION,
} from '@/lib/clinical-rules';
import type { Patient, PatientDocument } from '@/lib/types';

const completePatient = {
  nev: 'Teszt Elek',
  nem: 'férfi',
  szuletesiDatum: '1980-01-01',
  taj: '123456789',
  email: 'teszt@example.com',
  kezelesreErkezesIndoka: 'fogpótlás',
  diagnozis: 'edentulia',
  meglevoFogak: ['11', '12'],
} as unknown as Patient;

const opDoc = { tags: ['op'] } as unknown as PatientDocument;

describe('getChecklistStatus — protocol version traceability (WP7)', () => {
  it('stamps the protocol version on the result', () => {
    const status = getChecklistStatus(completePatient, [opDoc]);
    expect(status.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('is complete when all required fields and the OP doc are present', () => {
    const status = getChecklistStatus(completePatient, [opDoc]);
    expect(status.isComplete).toBe(true);
    expect(status.hasErrors).toBe(false);
  });

  it('flags missing required fields as errors and still carries the version', () => {
    const status = getChecklistStatus(null, []);
    expect(status.hasErrors).toBe(true);
    expect(status.isComplete).toBe(false);
    expect(status.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('reports the missing OP document', () => {
    const status = getChecklistStatus(completePatient, []);
    expect(status.missingDocs.map((d) => d.tag)).toContain('op');
    expect(status.isComplete).toBe(false);
  });
});

describe('email — ajánlott, nem kötelező mező', () => {
  const noEmail = { ...completePatient, email: '' } as unknown as Patient;

  it('az email hiánya figyelmeztetés, nem hiba', () => {
    const status = getChecklistStatus(noEmail, [opDoc]);
    expect(status.hasErrors).toBe(false);
    expect(status.hasWarnings).toBe(true);
    expect(status.missingFields.map((f) => f.key)).toEqual(['email']);
  });

  it('az email nem szigorúan kötelező, hanem ajánlott', () => {
    expect(isHardRequiredField('email')).toBe(false);
    expect(isRecommendedField('email')).toBe(true);
    expect(HARD_REQUIRED_FIELDS.map((f) => f.key)).not.toContain('email');
    expect(RECOMMENDED_FIELDS.map((f) => f.key)).toEqual(['email']);
  });

  it('a klinikai minimum többi mezője szigorúan kötelező marad', () => {
    const hard = ['nev', 'nem', 'szuletesiDatum', 'taj', 'kezelesreErkezesIndoka', 'diagnozis', 'meglevoFogak'] as const;
    for (const key of hard) {
      expect(isHardRequiredField(key)).toBe(true);
      expect(isRecommendedField(key)).toBe(false);
    }
  });
});
