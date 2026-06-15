import { describe, it, expect } from 'vitest';
import {
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_OPTIONS,
  APPOINTMENT_TYPE_VALUES,
  isAppointmentType,
  getAppointmentTypeLabel,
  getAppointmentTypeChip,
} from '@/lib/appointment-constants';

describe('APPOINTMENT_TYPE_LABELS', () => {
  it('has all five appointment types', () => {
    expect(APPOINTMENT_TYPE_LABELS.elso_konzultacio).toBe('Első konzultáció');
    expect(APPOINTMENT_TYPE_LABELS.munkafazis).toBe('Munkafázis');
    expect(APPOINTMENT_TYPE_LABELS.kontroll).toBe('Kontroll');
    expect(APPOINTMENT_TYPE_LABELS.recall).toBe('Recall');
    expect(APPOINTMENT_TYPE_LABELS.egyeb).toBe('Egyéb');
  });
});

describe('APPOINTMENT_TYPE_OPTIONS', () => {
  it('returns 5 options', () => {
    expect(APPOINTMENT_TYPE_OPTIONS).toHaveLength(5);
  });

  it('each option has value and label', () => {
    for (const option of APPOINTMENT_TYPE_OPTIONS) {
      expect(option.value).toBeTruthy();
      expect(option.label).toBeTruthy();
    }
  });
});

describe('APPOINTMENT_TYPE_VALUES', () => {
  it('matches exactly the values allowed by the DB CHECK (migration 060)', () => {
    expect([...APPOINTMENT_TYPE_VALUES].sort()).toEqual(
      ['egyeb', 'elso_konzultacio', 'kontroll', 'munkafazis', 'recall'].sort(),
    );
  });
});

describe('isAppointmentType', () => {
  it('guards known vs unknown values', () => {
    expect(isAppointmentType('munkafazis')).toBe(true);
    expect(isAppointmentType('recall')).toBe(true);
    expect(isAppointmentType('egyeb')).toBe(true);
    expect(isAppointmentType('nope')).toBe(false);
    expect(isAppointmentType(null)).toBe(false);
    expect(isAppointmentType(undefined)).toBe(false);
    expect(isAppointmentType(42)).toBe(false);
  });
});

describe('getAppointmentTypeLabel', () => {
  it('returns label for known types', () => {
    expect(getAppointmentTypeLabel('elso_konzultacio')).toBe('Első konzultáció');
    expect(getAppointmentTypeLabel('munkafazis')).toBe('Munkafázis');
    expect(getAppointmentTypeLabel('kontroll')).toBe('Kontroll');
    expect(getAppointmentTypeLabel('recall')).toBe('Recall');
  });

  it('returns empty string for null/undefined', () => {
    expect(getAppointmentTypeLabel(null)).toBe('');
    expect(getAppointmentTypeLabel(undefined)).toBe('');
  });

  it('returns the input for unknown types', () => {
    expect(getAppointmentTypeLabel('unknown_type')).toBe('unknown_type');
  });
});

describe('getAppointmentTypeChip', () => {
  it('returns the canonical chip for a known type with no label', () => {
    const chip = getAppointmentTypeChip('munkafazis');
    expect(chip).not.toBeNull();
    expect(chip!.label).toBe('Munkafázis');
    expect(chip!.emoji).toBe('🦷');
    expect(chip!.className).toContain('blue');
  });

  it('lets a free-text label override the label of a known type (trimmed)', () => {
    const chip = getAppointmentTypeChip('egyeb', '  implantátum kontroll 6h  ');
    expect(chip).not.toBeNull();
    expect(chip!.label).toBe('implantátum kontroll 6h');
    expect(chip!.emoji).toBe('✎');
  });

  it('falls back to a free-text chip when the type is unknown but a label exists', () => {
    const chip = getAppointmentTypeChip(null, 'sürgősségi konzílium');
    expect(chip).not.toBeNull();
    expect(chip!.label).toBe('sürgősségi konzílium');
    expect(chip!.emoji).toBe('✎');
  });

  it('returns null when there is nothing to show', () => {
    expect(getAppointmentTypeChip(null, null)).toBeNull();
    expect(getAppointmentTypeChip(undefined)).toBeNull();
    expect(getAppointmentTypeChip('', '   ')).toBeNull();
  });
});
