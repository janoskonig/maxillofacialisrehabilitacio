import { describe, it, expect } from 'vitest';
import { formatDateTime, toLocalISOString, digitsOnly, formatDateForDisplay, formatDateForInput, calculateAge } from '@/lib/dateUtils';

describe('formatDateTime', () => {
  it('formats a valid ISO date string in Hungarian locale', () => {
    const result = formatDateTime('2024-06-15T14:30:00Z');
    expect(result).toContain('2024');
    expect(result).toContain('30');
    expect(result).toMatch(/június/);
  });

  it('returns the input for invalid dates', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});

describe('toLocalISOString', () => {
  it('produces a string with timezone offset', () => {
    const date = new Date(2024, 5, 15, 14, 30, 0);
    const result = toLocalISOString(date);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(result).toContain('2024-06-15');
    expect(result).toContain('14:30:00');
  });

  it('includes correct date parts', () => {
    const date = new Date(2025, 0, 1, 9, 5, 0);
    const result = toLocalISOString(date);
    expect(result).toContain('2025-01-01');
    expect(result).toContain('09:05:00');
  });
});

describe('digitsOnly', () => {
  it('strips non-digit characters', () => {
    expect(digitsOnly('abc123def456')).toBe('123456');
  });

  it('returns empty string for non-digit input', () => {
    expect(digitsOnly('hello')).toBe('');
  });

  it('preserves digit-only input', () => {
    expect(digitsOnly('42')).toBe('42');
  });
});

describe('formatDateForDisplay', () => {
  it('formats YYYY-MM-DD correctly', () => {
    expect(formatDateForDisplay('2024-06-15')).toBe('2024-06-15');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatDateForDisplay(null)).toBe('');
    expect(formatDateForDisplay(undefined)).toBe('');
  });
});

describe('formatDateForInput', () => {
  it('passes through YYYY-MM-DD format', () => {
    expect(formatDateForInput('2024-06-15')).toBe('2024-06-15');
  });

  it('converts YYYY/MM/DD to YYYY-MM-DD', () => {
    expect(formatDateForInput('2024/06/15')).toBe('2024-06-15');
  });

  it('returns empty for null/undefined', () => {
    expect(formatDateForInput(null)).toBe('');
    expect(formatDateForInput(undefined)).toBe('');
  });
});

describe('calculateAge', () => {
  it('returns null for null input', () => {
    expect(calculateAge(null)).toBeNull();
  });

  it('returns a positive number for a past date', () => {
    const age = calculateAge('1990-01-01');
    expect(age).toBeGreaterThan(30);
  });

  it('returns null for invalid date', () => {
    expect(calculateAge('not-a-date')).toBeNull();
  });
});
