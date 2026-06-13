import { describe, it, expect } from 'vitest';
import { normalizeDoctorName } from '@/lib/recompute-referrer';

describe('normalizeDoctorName', () => {
  it('lowercases and trims', () => {
    expect(normalizeDoctorName('  Dr. Kovács Béla  ')).toBe('dr. kovács béla');
  });

  it('treats null/undefined/blank as empty', () => {
    expect(normalizeDoctorName(null)).toBe('');
    expect(normalizeDoctorName(undefined)).toBe('');
    expect(normalizeDoctorName('   ')).toBe('');
  });

  it('matches case- and whitespace-insensitively', () => {
    expect(normalizeDoctorName('DR. NAGY ANNA')).toBe(normalizeDoctorName('dr. nagy anna'));
  });
});
