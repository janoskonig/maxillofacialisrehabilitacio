import { describe, it, expect } from 'vitest';
import { chainBookingRequiredFromCounts } from '@/lib/chain-booking-status';

describe('chainBookingRequiredFromCounts', () => {
  it('requires chain when at least two open work intents', () => {
    expect(chainBookingRequiredFromCounts(2, 1)).toBe(true);
    expect(chainBookingRequiredFromCounts(3, 0)).toBe(true);
  });

  it('requires chain when multiple pending phases and at least one open intent', () => {
    expect(chainBookingRequiredFromCounts(1, 2)).toBe(true);
    expect(chainBookingRequiredFromCounts(1, 5)).toBe(true);
  });

  it('does not require when single intent and single pending phase', () => {
    expect(chainBookingRequiredFromCounts(1, 1)).toBe(false);
    expect(chainBookingRequiredFromCounts(0, 1)).toBe(false);
  });

  it('does not require when two pending phases but no open intents', () => {
    expect(chainBookingRequiredFromCounts(0, 2)).toBe(false);
  });
});
