import { describe, it, expect } from 'vitest';
import { normalizeDoctorName } from '@/lib/recompute-referrer';

describe('normalizeDoctorName', () => {
  it('lowercases, trims and strips accents', () => {
    // 2026-08-15: a szabály a közös lib/normalize-person-name.ts-re váltott, ami
    // ékezetet is bont — korábban ez a modul ékezet-érzékenyen hasonlított.
    expect(normalizeDoctorName('  Dr. Kovács Béla  ')).toBe('dr. kovacs bela');
  });

  it('treats null/undefined/blank as empty', () => {
    expect(normalizeDoctorName(null)).toBe('');
    expect(normalizeDoctorName(undefined)).toBe('');
    expect(normalizeDoctorName('   ')).toBe('');
  });

  it('matches case- and whitespace-insensitively', () => {
    expect(normalizeDoctorName('DR. NAGY ANNA')).toBe(normalizeDoctorName('dr. nagy anna'));
  });

  it('matches accent-insensitively', () => {
    expect(normalizeDoctorName('Dr. Fekete Ödön')).toBe(normalizeDoctorName('dr. fekete odon'));
    expect(normalizeDoctorName('Dr. Tűz Győző')).toBe(normalizeDoctorName('DR. TUZ GYOZO'));
  });
});
