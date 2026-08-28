/**
 * WP-4.3 — az alkalom-kártya fejléc-összegzéseinek pure helperei.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeVisitStatus,
  visitTotalMinutes,
  visitDisplayLabel,
  visitDateInfo,
  phaseScopeText,
  type EpisodeStep,
  type StepProjectionInfo,
} from '@/components/visit-plan/visit-plan-types';

function phase(overrides: Partial<EpisodeStep>): EpisodeStep {
  return {
    id: 'w1',
    episodeId: 'ep1',
    stepCode: 'lenyomat',
    pathwayOrderIndex: 0,
    pool: 'work',
    durationMinutes: 30,
    defaultDaysOffset: 7,
    status: 'pending',
    appointmentId: null,
    createdAt: '2026-08-01T10:00:00Z',
    completedAt: null,
    sourceEpisodePathwayId: null,
    seq: 0,
    visitId: 'v1',
    jaw: null,
    teeth: [],
    ...overrides,
  };
}

describe('summarizeVisitStatus', () => {
  it('üres alkalom → Üres', () => {
    expect(summarizeVisitStatus([]).label).toBe('Üres');
  });
  it('minden tag pending → Várakozik', () => {
    expect(summarizeVisitStatus([phase({}), phase({ id: 'w2' })]).label).toBe('Várakozik');
  });
  it('minden tag scheduled → Foglalva', () => {
    expect(
      summarizeVisitStatus([phase({ status: 'scheduled' }), phase({ id: 'w2', status: 'scheduled' })]).label
    ).toBe('Foglalva');
  });
  it('minden tag completed → Teljesült', () => {
    expect(summarizeVisitStatus([phase({ status: 'completed' })]).label).toBe('Teljesült');
  });
  it('vegyes állapot → Vegyes', () => {
    expect(
      summarizeVisitStatus([phase({ status: 'completed' }), phase({ id: 'w2', status: 'pending' })]).label
    ).toBe('Vegyes');
  });
  it('a kihagyott tag nem számít bele (csak skipped → Kihagyva)', () => {
    expect(
      summarizeVisitStatus([phase({ status: 'skipped' }), phase({ id: 'w2', status: 'scheduled' })]).label
    ).toBe('Foglalva');
    expect(summarizeVisitStatus([phase({ status: 'skipped' })]).label).toBe('Kihagyva');
  });
});

describe('visitTotalMinutes', () => {
  it('a tagok percösszege, kihagyott nélkül', () => {
    expect(
      visitTotalMinutes(null, [
        phase({ durationMinutes: 30 }),
        phase({ id: 'w2', durationMinutes: 15 }),
        phase({ id: 'w3', durationMinutes: 60, status: 'skipped' }),
      ])
    ).toBe(45);
  });
  it('a vizit plannedDurationMinutes felülírja az összeget', () => {
    expect(
      visitTotalMinutes({ plannedDurationMinutes: 90 }, [phase({ durationMinutes: 30 })])
    ).toBe(90);
  });
  it('üres alkalom → null', () => {
    expect(visitTotalMinutes(null, [])).toBeNull();
  });
});

describe('visitDisplayLabel', () => {
  const getLabel = (s: EpisodeStep) => s.customLabel ?? s.stepCode;
  it('a vizit label-je nyer', () => {
    expect(visitDisplayLabel({ label: 'Átadó vizit' }, [phase({})], getLabel)).toBe('Átadó vizit');
  });
  it('label nélkül a fázisok címkéiből képződik', () => {
    expect(visitDisplayLabel(null, [phase({ customLabel: 'Lenyomat' })], getLabel)).toBe('Lenyomat');
    expect(
      visitDisplayLabel(
        null,
        [
          phase({ customLabel: 'Lenyomat' }),
          phase({ id: 'w2', customLabel: 'Vázpróba' }),
          phase({ id: 'w3', customLabel: 'Átadás' }),
        ],
        getLabel
      )
    ).toBe('Lenyomat + Vázpróba +1');
  });
  it('üres alkalom → Üres alkalom', () => {
    expect(visitDisplayLabel(null, [], getLabel)).toBe('Üres alkalom');
  });
});

describe('visitDateInfo', () => {
  it('foglalt tag → a foglalt dátum', () => {
    const proj = new Map<string, StepProjectionInfo>([
      ['w1', { workPhaseId: 'w1', status: 'scheduled', actualDate: '2026-09-10T08:00:00Z', windowStart: null, windowEnd: null, waitFromNowDays: 3 }],
    ]);
    const info = visitDateInfo([phase({ status: 'scheduled' })], proj);
    expect(info?.kind).toBe('booked');
  });
  it('várakozó tagok → becsült ablak (min–max)', () => {
    const proj = new Map<string, StepProjectionInfo>([
      ['w1', { workPhaseId: 'w1', status: 'pending', actualDate: null, windowStart: '2026-09-01T00:00:00Z', windowEnd: '2026-09-05T00:00:00Z', waitFromNowDays: 5 }],
      ['w2', { workPhaseId: 'w2', status: 'pending', actualDate: null, windowStart: '2026-09-03T00:00:00Z', windowEnd: '2026-09-09T00:00:00Z', waitFromNowDays: 7 }],
    ]);
    const info = visitDateInfo([phase({}), phase({ id: 'w2' })], proj);
    expect(info?.kind).toBe('window');
    expect(info?.text).toContain('–');
  });
  it('minden tag kész → a teljesítés dátuma', () => {
    const info = visitDateInfo(
      [phase({ status: 'completed', completedAt: '2026-08-20T10:00:00Z' })],
      new Map()
    );
    expect(info?.kind).toBe('done');
  });
  it('vetítés nélkül → null', () => {
    expect(visitDateInfo([phase({})], new Map())).toBeNull();
  });
});

describe('phaseScopeText', () => {
  it('fogszám-lista nyer', () => {
    expect(phaseScopeText(phase({ teeth: ['11', '12'], jaw: 'felso' }))).toBe('fog 11, 12');
  });
  it('állcsont, ha nincs fog-lista', () => {
    expect(phaseScopeText(phase({ jaw: 'mindketto' }))).toBe('mindkét állcsont');
  });
  it('legacy 1:1 fog', () => {
    expect(phaseScopeText(phase({ toothNumber: 24 }))).toBe('fog #24');
  });
  it('hatókör nélkül → null', () => {
    expect(phaseScopeText(phase({}))).toBeNull();
  });
});
