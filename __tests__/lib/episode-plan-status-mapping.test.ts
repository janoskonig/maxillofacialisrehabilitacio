import { describe, expect, it } from 'vitest';
import { mapEwpStatusToPlanItemStatus } from '@/lib/episode-plan-status-mapping';

describe('mapEwpStatusToPlanItemStatus', () => {
  it('maps pending and unknown to planned', () => {
    expect(mapEwpStatusToPlanItemStatus('pending')).toBe('planned');
    expect(mapEwpStatusToPlanItemStatus('anything')).toBe('planned');
  });
  it('maps scheduled, completed, skipped', () => {
    expect(mapEwpStatusToPlanItemStatus('scheduled')).toBe('scheduled');
    expect(mapEwpStatusToPlanItemStatus('completed')).toBe('completed');
    expect(mapEwpStatusToPlanItemStatus('skipped')).toBe('cancelled');
  });
});
