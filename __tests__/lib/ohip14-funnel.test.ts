import { describe, it, expect } from 'vitest';
import { classifyTimepointStatus } from '@/lib/ohip14-funnel';
import type { TimepointAvailability } from '@/lib/ohip14-timepoint-stage';

const NOW = new Date('2026-07-01T12:00:00Z');

const avail = (partial: Partial<TimepointAvailability>): TimepointAvailability => ({
  allowed: false,
  ...partial,
});

describe('classifyTimepointStatus', () => {
  it('kitöltött válasz mindent felülír', () => {
    expect(classifyTimepointStatus('T1', true, avail({ allowed: false }), NOW)).toBe('completed');
    expect(classifyTimepointStatus('T0', true, avail({ allowed: true }), NOW)).toBe('completed');
  });

  it('nyitott ablak → pending_open', () => {
    expect(classifyTimepointStatus('T1', false, avail({ allowed: true }), NOW)).toBe('pending_open');
  });

  it('T0 zárt ablak (stádium túllépett) → missed', () => {
    expect(classifyTimepointStatus('T0', false, avail({ allowed: false }), NOW)).toBe('missed');
  });

  it('T1 átadás előtt (nincs opensAt) → not_open', () => {
    expect(classifyTimepointStatus('T1', false, avail({ allowed: false }), NOW)).toBe('not_open');
  });

  it('T1 ablak még nem nyílt meg → not_open', () => {
    expect(
      classifyTimepointStatus(
        'T1',
        false,
        avail({ allowed: false, opensAt: new Date('2026-08-01'), closesAt: new Date('2026-10-01') }),
        NOW
      )
    ).toBe('not_open');
  });

  it('T1 lezárult ablak kitöltés nélkül → missed', () => {
    expect(
      classifyTimepointStatus(
        'T1',
        false,
        avail({ allowed: false, opensAt: new Date('2026-01-01'), closesAt: new Date('2026-06-01') }),
        NOW
      )
    ).toBe('missed');
  });

  it('T3 nyitva marad (nincs closesAt), de nem engedett és múltbeli opensAt → not_open a biztos ág', () => {
    // Védőág: ha nincs záró dátum és nem engedett, nem számoljuk kihagyottnak.
    expect(
      classifyTimepointStatus('T3', false, avail({ allowed: false, opensAt: new Date('2026-01-01') }), NOW)
    ).toBe('not_open');
  });
});
