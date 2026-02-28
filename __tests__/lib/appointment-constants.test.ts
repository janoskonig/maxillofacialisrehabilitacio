import { describe, it, expect } from 'vitest';
import {
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_OPTIONS,
  getAppointmentTypeLabel,
} from '@/lib/appointment-constants';

describe('APPOINTMENT_TYPE_LABELS', () => {
  it('has all three appointment types', () => {
    expect(APPOINTMENT_TYPE_LABELS.elso_konzultacio).toBe('Első konzultáció');
    expect(APPOINTMENT_TYPE_LABELS.munkafazis).toBe('Munkafázis');
    expect(APPOINTMENT_TYPE_LABELS.kontroll).toBe('Kontroll');
  });
});

describe('APPOINTMENT_TYPE_OPTIONS', () => {
  it('returns 3 options', () => {
    expect(APPOINTMENT_TYPE_OPTIONS).toHaveLength(3);
  });

  it('each option has value and label', () => {
    for (const option of APPOINTMENT_TYPE_OPTIONS) {
      expect(option.value).toBeTruthy();
      expect(option.label).toBeTruthy();
    }
  });
});

describe('getAppointmentTypeLabel', () => {
  it('returns label for known types', () => {
    expect(getAppointmentTypeLabel('elso_konzultacio')).toBe('Első konzultáció');
    expect(getAppointmentTypeLabel('munkafazis')).toBe('Munkafázis');
    expect(getAppointmentTypeLabel('kontroll')).toBe('Kontroll');
  });

  it('returns empty string for null/undefined', () => {
    expect(getAppointmentTypeLabel(null)).toBe('');
    expect(getAppointmentTypeLabel(undefined)).toBe('');
  });

  it('returns the input for unknown types', () => {
    expect(getAppointmentTypeLabel('unknown_type')).toBe('unknown_type');
  });
});
