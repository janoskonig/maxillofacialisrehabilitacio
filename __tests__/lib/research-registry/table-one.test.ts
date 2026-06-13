import { describe, it, expect } from 'vitest';
import { computeTableOne, type TableOneContinuousRow, type TableOneCategoricalRow } from '@/lib/research-registry/table-one';
import type { AnalysisRow } from '@/lib/research-registry/analysis-projection';

function mkRow(partial: Partial<AnalysisRow>): AnalysisRow {
  return {
    anonymized_subject_key: Math.random().toString(36).slice(2),
    age_band_start: null,
    region_prefix: null,
    nem: null,
    etiologia: null,
    maxilladefektus: null,
    mandibuladefektus: null,
    brown_fuggoleges: null,
    brown_vizszintes: null,
    kovacs_dobak: null,
    tnm_staging: null,
    radioterapia: null,
    radioterapia_dozis_gy: null,
    chemoterapia: null,
    dohanyzas_szam_ertek: null,
    ohip_t0_total: null,
    ohip_t1_total: null,
    ohip_t2_total: null,
    ohip_t3_total: null,
    completeness_score: null,
    ...partial,
  };
}

const rows: AnalysisRow[] = [
  mkRow({ nem: 'ferfi', etiologia: 'onkológiai kezelés utáni állapot', radioterapia: true, radioterapia_dozis_gy: 60, ohip_t0_total: 20 }),
  mkRow({ nem: 'ferfi', etiologia: 'onkológiai kezelés utáni állapot', radioterapia: true, radioterapia_dozis_gy: 66, ohip_t0_total: 30 }),
  mkRow({ nem: 'no', etiologia: 'traumás sérülés', radioterapia: false, radioterapia_dozis_gy: null, ohip_t0_total: 10 }),
  mkRow({ nem: 'no', etiologia: 'traumás sérülés', radioterapia: false, radioterapia_dozis_gy: null, ohip_t0_total: null }),
];

describe('computeTableOne (overall)', () => {
  const t1 = computeTableOne(rows);

  it('reports the total n', () => {
    expect(t1.n).toBe(4);
    expect(t1.groupBy).toBeNull();
  });

  it('computes categorical counts and percentages over non-missing', () => {
    const nem = t1.rows.find((r) => r.variable === 'nem') as TableOneCategoricalRow;
    const ferfi = nem.levels.find((l) => l.level === 'ferfi')!;
    expect(ferfi.overall.n).toBe(2);
    expect(ferfi.overall.pct).toBe(50);
    expect(nem.missing.overall).toBe(0);
  });

  it('computes continuous stats with missing handling', () => {
    const ohip = t1.rows.find((r) => r.variable === 'ohip_t0_total') as TableOneContinuousRow;
    expect(ohip.overall.n).toBe(3);
    expect(ohip.overall.missing).toBe(1);
    expect(ohip.overall.mean).toBe(20); // (20+30+10)/3
    expect(ohip.overall.median).toBe(20);
    expect(ohip.overall.min).toBe(10);
    expect(ohip.overall.max).toBe(30);
  });

  it('counts missing continuous values rather than treating them as zero', () => {
    const dose = t1.rows.find((r) => r.variable === 'radioterapia_dozis_gy') as TableOneContinuousRow;
    expect(dose.overall.n).toBe(2);
    expect(dose.overall.missing).toBe(2);
    expect(dose.overall.mean).toBe(63); // (60+66)/2
  });
});

describe('computeTableOne (stratified by etiologia)', () => {
  const t1 = computeTableOne(rows, { groupBy: 'etiologia' });

  it('lists the groups and excludes the groupBy var from the rows', () => {
    expect(t1.groupBy).toBe('etiologia');
    expect(t1.groups).toEqual(['onkológiai kezelés utáni állapot', 'traumás sérülés']);
    expect(t1.rows.some((r) => r.variable === 'etiologia')).toBe(false);
  });

  it('computes per-group continuous stats', () => {
    const ohip = t1.rows.find((r) => r.variable === 'ohip_t0_total') as TableOneContinuousRow;
    expect(ohip.byGroup!['onkológiai kezelés utáni állapot'].mean).toBe(25); // (20+30)/2
    expect(ohip.byGroup!['traumás sérülés'].n).toBe(1); // only 10; the null excluded
    expect(ohip.byGroup!['traumás sérülés'].mean).toBe(10);
  });

  it('computes per-group categorical breakdown', () => {
    const rt = t1.rows.find((r) => r.variable === 'radioterapia') as TableOneCategoricalRow;
    const trueLevel = rt.levels.find((l) => l.level === 'true')!;
    expect(trueLevel.byGroup!['onkológiai kezelés utáni állapot'].n).toBe(2);
    expect(trueLevel.byGroup!['onkológiai kezelés utáni állapot'].pct).toBe(100);
    expect(trueLevel.byGroup!['traumás sérülés'].n).toBe(0);
  });

  it('ignores a non-categorical or unknown groupBy', () => {
    expect(computeTableOne(rows, { groupBy: 'ohip_t0_total' }).groupBy).toBeNull();
    expect(computeTableOne(rows, { groupBy: 'nope' }).groupBy).toBeNull();
  });
});
