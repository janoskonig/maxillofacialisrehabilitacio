import { describe, it, expect } from 'vitest';
import { resolveSchedulingAnchor } from '@/lib/scheduling-anchor';

describe('resolveSchedulingAnchor', () => {
  const opened = new Date('2024-01-01T10:00:00Z');
  const planStart = new Date('2024-06-01T10:00:00Z');
  const lastAppt = new Date('2024-03-15T10:00:00Z');
  const lastResolved = new Date('2024-04-01T10:00:00Z');

  it('prefers lastResolvedAt over everything else', () => {
    const anchor = resolveSchedulingAnchor({
      lastResolvedAt: lastResolved,
      lastCompletedAppointmentAt: lastAppt,
      planStartDate: planStart,
      openedAt: opened,
    });
    expect(anchor.toISOString()).toBe(lastResolved.toISOString());
  });

  it('uses last completed appointment when no resolved phase', () => {
    const anchor = resolveSchedulingAnchor({
      lastResolvedAt: null,
      lastCompletedAppointmentAt: lastAppt,
      planStartDate: planStart,
      openedAt: opened,
    });
    expect(anchor.toISOString()).toBe(lastAppt.toISOString());
  });

  it('uses planStartDate when no completed facts', () => {
    const anchor = resolveSchedulingAnchor({
      lastResolvedAt: null,
      lastCompletedAppointmentAt: null,
      planStartDate: planStart,
      openedAt: opened,
    });
    expect(anchor.toISOString()).toBe(planStart.toISOString());
  });

  it('falls back to openedAt', () => {
    const anchor = resolveSchedulingAnchor({
      lastResolvedAt: null,
      lastCompletedAppointmentAt: null,
      planStartDate: null,
      openedAt: opened,
    });
    expect(anchor.toISOString()).toBe(opened.toISOString());
  });
});
