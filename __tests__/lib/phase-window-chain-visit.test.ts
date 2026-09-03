/**
 * WP-4.2 — vizit-tudatos ablak-lánc (computeVisitAwareWindowChain).
 *
 * Kompatibilitási invariáns: ahol minden vizit egyfős és a days_offset a
 * fázisból jött (a 089-es backfill állapota), a kimenet numerikusan megegyezik
 * a computePhaseWindowChain mai értékeivel — a Gantt/becslés nem mozdulhat el
 * a vizit-modell bevezetésétől önmagában.
 */
import { describe, expect, it } from 'vitest';
import {
  computePhaseWindowChain,
  computeVisitAwareWindowChain,
  type PhaseWindowChainRow,
  type VisitAwareChainRow,
} from '@/lib/phase-window-chain';

const ANCHOR = new Date('2026-09-01T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function legacyRow(code: string, offset: number, over: Partial<PhaseWindowChainRow> = {}): PhaseWindowChainRow {
  return {
    workPhaseCode: code,
    defaultDaysOffset: offset,
    status: 'pending',
    completedAt: null,
    bookedStart: null,
    ...over,
  };
}

describe('computeVisitAwareWindowChain — kompatibilitási invariáns', () => {
  it('egyfős vizitek + fázis-offset (backfill-állapot) = a mai lánc értékei', () => {
    const legacy = [
      legacyRow('lenyomat', 7),
      legacyRow('probafelvetel', 14, { completedAt: new Date('2026-09-20T09:00:00.000Z') }),
      legacyRow('atadas', 10),
    ];
    const visitRows: VisitAwareChainRow[] = legacy.map((r, i) => ({
      ...r,
      rowKey: `row-${i}`,
      visitId: `visit-${i}`,
      visitDaysOffset: null, // backfillnél a days_offset a fázisból jön — itt a fallback út
    }));

    const oldMap = computePhaseWindowChain(legacy, ANCHOR);
    const newMap = computeVisitAwareWindowChain(visitRows, ANCHOR);

    for (let i = 0; i < legacy.length; i++) {
      const oldRes = oldMap.get(legacy[i].workPhaseCode)!;
      const newRes = newMap.get(`row-${i}`)!;
      expect(newRes.windowStart.getTime()).toBe(oldRes.windowStart.getTime());
      expect(newRes.windowEnd.getTime()).toBe(oldRes.windowEnd.getTime());
      expect(newRes.expectedDate.getTime()).toBe(oldRes.expectedDate.getTime());
      expect(newRes.earliestAllowedStart.getTime()).toBe(oldRes.earliestAllowedStart.getTime());
    }
  });

  it('vizit nélküli (legacy) sorok egyfős egységként viselkednek', () => {
    const legacy = [legacyRow('lenyomat', 7), legacyRow('atadas', 10)];
    const visitRows: VisitAwareChainRow[] = legacy.map((r, i) => ({
      ...r,
      rowKey: `row-${i}`,
      visitId: null,
      visitDaysOffset: null,
    }));
    const oldMap = computePhaseWindowChain(legacy, ANCHOR);
    const newMap = computeVisitAwareWindowChain(visitRows, ANCHOR);
    for (let i = 0; i < legacy.length; i++) {
      expect(newMap.get(`row-${i}`)!.expectedDate.getTime()).toBe(
        oldMap.get(legacy[i].workPhaseCode)!.expectedDate.getTime()
      );
    }
  });
});

describe('computeVisitAwareWindowChain — vizit-viselkedés', () => {
  it('egy vizit tagjai közös ablakot kapnak (nincs tag-közi nap-eltolás)', () => {
    const rows: VisitAwareChainRow[] = [
      { ...legacyRow('lenyomat', 7), rowKey: 'a', visitId: 'v1', visitDaysOffset: 7 },
      { ...legacyRow('harapasregisztracio', 14), rowKey: 'b', visitId: 'v1', visitDaysOffset: 7 },
      { ...legacyRow('atadas', 10), rowKey: 'c', visitId: 'v2', visitDaysOffset: 10 },
    ];
    const map = computeVisitAwareWindowChain(rows, ANCHOR);
    const a = map.get('a')!;
    const b = map.get('b')!;
    const c = map.get('c')!;
    // Azonos vizit → azonos ablak (a 'b' 14 napos fázis-offsetje NEM lép közbe).
    expect(a.windowStart.getTime()).toBe(b.windowStart.getTime());
    expect(a.expectedDate.getTime()).toBe(b.expectedDate.getTime());
    // A következő vizit a CÉL-vizit days_offset-jével lép (10 nap az előző alkalom várható napjától).
    expect(c.expectedDate.getTime()).toBe(a.expectedDate.getTime() + 10 * DAY_MS);
  });

  it('a vizit days_offset-je felülírja a fázis offsetjét; NULL-nál az első tag fázis-offsetje él', () => {
    const rows: VisitAwareChainRow[] = [
      { ...legacyRow('lenyomat', 7), rowKey: 'a', visitId: 'v1', visitDaysOffset: 3 },
      { ...legacyRow('atadas', 10), rowKey: 'b', visitId: 'v2', visitDaysOffset: null },
    ];
    const map = computeVisitAwareWindowChain(rows, ANCHOR);
    // v1: vizit-offset 3 (nem a fázis 7 napja).
    expect(map.get('a')!.expectedDate.getTime()).toBe(ANCHOR.getTime() + 3 * DAY_MS);
    // v2: NULL vizit-offset → az első tag fázis-offsetje (10 nap).
    expect(map.get('b')!.expectedDate.getTime()).toBe(
      map.get('a')!.expectedDate.getTime() + 10 * DAY_MS
    );
  });

  it('duplikált work_phase_code-ú testvérek nem írják felül egymás ablakát (rowKey-kulcs)', () => {
    const rows: VisitAwareChainRow[] = [
      { ...legacyRow('lenyomat', 7), rowKey: 'felso', visitId: 'v1', visitDaysOffset: 7 },
      { ...legacyRow('lenyomat', 7), rowKey: 'also', visitId: 'v2', visitDaysOffset: 7 },
    ];
    const map = computeVisitAwareWindowChain(rows, ANCHOR);
    expect(map.get('felso')).toBeDefined();
    expect(map.get('also')).toBeDefined();
    expect(map.get('also')!.expectedDate.getTime()).toBe(
      map.get('felso')!.expectedDate.getTime() + 7 * DAY_MS
    );
  });

  it('a vizit teljesítése (bármely tag) horgonyozza a következő alkalmat', () => {
    const done = new Date('2026-09-15T09:00:00.000Z');
    const rows: VisitAwareChainRow[] = [
      { ...legacyRow('lenyomat', 7), rowKey: 'a', visitId: 'v1', visitDaysOffset: 7 },
      {
        ...legacyRow('harapasregisztracio', 14, { status: 'completed', completedAt: done }),
        rowKey: 'b',
        visitId: 'v1',
        visitDaysOffset: 7,
      },
      { ...legacyRow('atadas', 10), rowKey: 'c', visitId: 'v2', visitDaysOffset: 10 },
    ];
    const map = computeVisitAwareWindowChain(rows, ANCHOR);
    // A c alkalom a teljesített v1-hez horgonyzik: earliestAllowedStart >= done + 10 nap.
    expect(map.get('c')!.earliestAllowedStart.getTime()).toBeGreaterThanOrEqual(
      done.getTime() + 10 * DAY_MS
    );
  });
});

describe('computeVisitAwareWindowChain — a terv rácsúszik a vázra (puzzle v2 plafon)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  it('a foglalt egység ELŐTTI tervezett egység ablaka a foglalás előtti napra szorul', () => {
    const anchor = new Date('2026-09-02T08:00:00Z');
    const booked = new Date('2026-09-10T09:00:00Z');
    const out = computeVisitAwareWindowChain(
      [
        { rowKey: 'a', workPhaseCode: 'a', defaultDaysOffset: 7, status: 'pending', completedAt: null, bookedStart: null, visitId: 'v1', visitDaysOffset: 7 },
        { rowKey: 'b', workPhaseCode: 'b', defaultDaysOffset: 7, status: 'scheduled', completedAt: null, bookedStart: booked, visitId: 'v2', visitDaysOffset: 7 },
      ],
      anchor
    );
    const a = out.get('a')!;
    expect(a.windowEnd.getTime()).toBe(booked.getTime() - DAY);
    expect(a.expectedDate.getTime()).toBeLessThanOrEqual(a.windowEnd.getTime());
    expect(a.windowStart.getTime()).toBeLessThanOrEqual(a.windowEnd.getTime());
    // A foglalt egység ablakát a plafon nem érinti.
    const b = out.get('b')!;
    expect(b.windowStart.getTime()).toBeGreaterThan(0);
  });

  it('ha a horgony a következő fix pont mögött van, az egész ablak a plafonra ül (nem fordul meg)', () => {
    const anchor = new Date('2027-03-24T08:00:00Z'); // pl. jövőbeli teljesítés a láncban
    const booked = new Date('2026-09-03T09:00:00Z');
    const out = computeVisitAwareWindowChain(
      [
        { rowKey: 'a', workPhaseCode: 'a', defaultDaysOffset: 7, status: 'pending', completedAt: null, bookedStart: null, visitId: 'v1', visitDaysOffset: 7 },
        { rowKey: 'b', workPhaseCode: 'b', defaultDaysOffset: 7, status: 'scheduled', completedAt: null, bookedStart: booked, visitId: 'v2', visitDaysOffset: 7 },
      ],
      anchor
    );
    const a = out.get('a')!;
    expect(a.windowEnd.getTime()).toBe(booked.getTime() - DAY);
    expect(a.windowStart.getTime()).toBe(a.windowEnd.getTime());
    expect(a.earliestAllowedStart.getTime()).toBeLessThanOrEqual(a.windowEnd.getTime());
  });

  it('a lánc végén álló tervezett egységre nincs plafon', () => {
    const anchor = new Date('2026-09-02T08:00:00Z');
    const out = computeVisitAwareWindowChain(
      [
        { rowKey: 'b', workPhaseCode: 'b', defaultDaysOffset: 7, status: 'scheduled', completedAt: null, bookedStart: new Date('2026-09-10T09:00:00Z'), visitId: 'v1', visitDaysOffset: 7 },
        { rowKey: 'c', workPhaseCode: 'c', defaultDaysOffset: 7, status: 'pending', completedAt: null, bookedStart: null, visitId: 'v2', visitDaysOffset: 14 },
      ],
      anchor
    );
    const c = out.get('c')!;
    // 14 nappal a foglalás után várható, ablak +14 nap
    expect(c.expectedDate.getTime()).toBe(new Date('2026-09-24T09:00:00Z').getTime());
    expect(c.windowEnd.getTime()).toBe(new Date('2026-10-08T09:00:00Z').getTime());
  });
});
