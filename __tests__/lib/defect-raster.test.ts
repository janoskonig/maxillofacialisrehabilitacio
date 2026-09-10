import { describe, it, expect } from 'vitest';
import {
  DEFECT_RASTER_LAYOUTS,
  DEFECT_RASTER_ROWS,
  DEFECT_RASTER_COLS,
  cellKey,
  parseCellKey,
  zoneAt,
  isSelectableCell,
  selectableCellKeys,
  normalizeDefectRaster,
  isDefectRasterEmpty,
  setDefectCell,
  toggleDefectCell,
  summarizeDefectRaster,
  describeDefectCell,
} from '@/lib/defect-raster';

describe('DEFECT_RASTER_LAYOUTS — zónatérkép konzisztencia', () => {
  for (const jaw of ['maxilla', 'mandibula'] as const) {
    const layout = DEFECT_RASTER_LAYOUTS[jaw];

    it(`${jaw}: 6×8-as rács, minden sor pontosan 8 karakter, címkék teljesek`, () => {
      expect(layout.rows).toBe(DEFECT_RASTER_ROWS);
      expect(layout.cols).toBe(DEFECT_RASTER_COLS);
      expect(layout.zones).toHaveLength(layout.rows);
      for (const row of layout.zones) expect(row).toHaveLength(layout.cols);
      expect(layout.rowLabels).toHaveLength(layout.rows);
      expect(layout.rowDescriptions).toHaveLength(layout.rows);
      expect(layout.colLabels).toHaveLength(layout.cols);
    });

    it(`${jaw}: a zónatérkép jobb-bal szimmetrikus, minden zónakódnak van címkéje`, () => {
      for (const row of layout.zones) {
        expect(row).toBe(Array.from(row).reverse().join(''));
        for (const ch of Array.from(row)) {
          if (ch !== '.') expect(layout.zoneLabels[ch as keyof typeof layout.zoneLabels]).toBeTruthy();
        }
      }
    });
  }

  it('a metszők sora (r0) mindkét állcsonton a középső négy mezőn jelölhető', () => {
    for (const jaw of ['maxilla', 'mandibula'] as const) {
      const l = DEFECT_RASTER_LAYOUTS[jaw];
      expect([0, 1, 6, 7].map((c) => isSelectableCell(l, 0, c))).toEqual([false, false, false, false]);
      expect([2, 3, 4, 5].map((c) => isSelectableCell(l, 0, c))).toEqual([true, true, true, true]);
    }
  });

  it('a lágyszájpad csak a maxillán, a ramus csak a mandibulán létezik', () => {
    expect(zoneAt(DEFECT_RASTER_LAYOUTS.maxilla, 5, 3)).toBe('S');
    expect(zoneAt(DEFECT_RASTER_LAYOUTS.maxilla, 5, 0)).toBeNull();
    expect(zoneAt(DEFECT_RASTER_LAYOUTS.mandibula, 5, 0)).toBe('C');
    expect(zoneAt(DEFECT_RASTER_LAYOUTS.mandibula, 5, 3)).toBeNull();
    expect(zoneAt(DEFECT_RASTER_LAYOUTS.mandibula, 4, 0)).toBe('R');
  });

  it('a rácson kívüli koordináta nem jelölhető', () => {
    const l = DEFECT_RASTER_LAYOUTS.maxilla;
    expect(zoneAt(l, -1, 0)).toBeNull();
    expect(zoneAt(l, 6, 0)).toBeNull();
    expect(zoneAt(l, 0, 8)).toBeNull();
  });
});

describe('cellKey / parseCellKey', () => {
  it('oda-vissza', () => {
    expect(cellKey(3, 1)).toBe('r3c1');
    expect(parseCellKey('r3c1')).toEqual({ row: 3, col: 1 });
  });

  it('érvénytelen kulcsokra null', () => {
    expect(parseCellKey('3-1')).toBeNull();
    expect(parseCellKey('r3')).toBeNull();
    expect(parseCellKey(31)).toBeNull();
    expect(parseCellKey(null)).toBeNull();
  });
});

describe('normalizeDefectRaster', () => {
  it('eldobja az érvénytelen és nem jelölhető kulcsokat, deduplikál, sor-major rendez', () => {
    expect(normalizeDefectRaster('maxilla', ['r3c1', 'r0c0', 'x', 42, 'r3c1', 'r1c2', 'r9c9'])).toEqual([
      'r1c2',
      'r3c1',
    ]);
  });

  it('JSON-szöveget is elfogad; hibás / nem tömb bemenetre üres', () => {
    expect(normalizeDefectRaster('maxilla', '["r2c3"]')).toEqual(['r2c3']);
    expect(normalizeDefectRaster('maxilla', '{')).toEqual([]);
    expect(normalizeDefectRaster('maxilla', null)).toEqual([]);
    expect(normalizeDefectRaster('maxilla', undefined)).toEqual([]);
    expect(normalizeDefectRaster('maxilla', { r2c3: true })).toEqual([]);
  });

  it('isDefectRasterEmpty: a csak nem jelölhető kulcsokat tartalmazó lista is üres', () => {
    expect(isDefectRasterEmpty('mandibula', [])).toBe(true);
    expect(isDefectRasterEmpty('mandibula', ['r0c0'])).toBe(true);
    expect(isDefectRasterEmpty('mandibula', ['r3c0'])).toBe(false);
  });
});

describe('setDefectCell / toggleDefectCell', () => {
  it('be- és kikapcsol, a nem jelölhető mező nem változtat', () => {
    expect(setDefectCell('maxilla', [], 'r3c1', true)).toEqual(['r3c1']);
    expect(setDefectCell('maxilla', ['r3c1'], 'r3c1', false)).toEqual([]);
    expect(setDefectCell('maxilla', ['r3c1'], 'r3c1', true)).toEqual(['r3c1']);
    expect(setDefectCell('maxilla', ['r3c1'], 'r0c0', true)).toEqual(['r3c1']);
    expect(toggleDefectCell('maxilla', ['r3c1'], 'r3c2')).toEqual(['r3c1', 'r3c2']);
    expect(toggleDefectCell('maxilla', ['r3c1', 'r3c2'], 'r3c1')).toEqual(['r3c2']);
  });
});

describe('summarizeDefectRaster', () => {
  it('üres: nincs bejelölt mező', () => {
    const s = summarizeDefectRaster('maxilla', []);
    expect(s.count).toBe(0);
    expect(s.side).toBeNull();
    expect(s.rowRange).toBeNull();
    expect(s.total).toBe(selectableCellKeys(DEFECT_RASTER_LAYOUTS.maxilla).length);
    expect(s.text).toBe('Nincs bejelölt mező.');
  });

  it('egyoldali (jobb) alveolus + szájpad, a középvonalig ér', () => {
    const s = summarizeDefectRaster('maxilla', ['r3c1', 'r3c2', 'r3c3']);
    expect(s.side).toBe('jobb');
    expect(s.bilateral).toBe(false);
    expect(s.reachesMidline).toBe(true);
    expect(s.zones).toEqual(['A', 'P']);
    expect(s.rowRange).toEqual([3, 3]);
    expect(s.text).toContain('Jobb oldali defektus');
    expect(s.text).toContain('processus alveolaris, palatum durum');
    expect(s.text).toContain('szint: nagyőrlők szintje');
    expect(s.text).toContain('a középvonalig ér');
    expect(s.text).not.toContain('átlépi');
  });

  it('kétoldali: átlépi a középvonalat, több szint', () => {
    const s = summarizeDefectRaster('mandibula', ['r0c3', 'r0c4', 'r1c5', 'r3c6']);
    expect(s.side).toBe('kétoldali');
    expect(s.bilateral).toBe(true);
    expect(s.rowRange).toEqual([0, 3]);
    expect(s.text).toContain('Kétoldali defektus');
    expect(s.text).toContain('a középvonalat átlépi');
    expect(s.text).toContain('metszők szintje (symphysis) – nagyőrlők szintje');
  });

  it('bal oldali angulus + ramus, a középvonaltól távol', () => {
    const s = summarizeDefectRaster('mandibula', ['r5c7', 'r4c7']);
    expect(s.side).toBe('bal');
    expect(s.zones).toEqual(['R', 'C']);
    expect(s.reachesMidline).toBe(false);
    expect(s.text).toContain('angulus mandibulae, ramus / condylus');
  });

  it('a százalék a jelölhető mezőkre vonatkozik, a bemenetet normalizálja', () => {
    const total = selectableCellKeys(DEFECT_RASTER_LAYOUTS.maxilla).length;
    const s = summarizeDefectRaster('maxilla', ['r2c3', 'r2c3', 'r0c0']);
    expect(s.count).toBe(1);
    expect(s.percent).toBe(Math.round(100 / total));
  });
});

describe('describeDefectCell', () => {
  it('szint · oszlop · zóna', () => {
    expect(describeDefectCell('maxilla', 'r3c1')).toBe('nagyőrlők szintje · J3 · processus alveolaris');
    expect(describeDefectCell('mandibula', 'r5c7')).toBe('ramus / condylus · B4 · ramus / condylus');
    expect(describeDefectCell('maxilla', 'r0c0')).toBe('metszők szintje · J4 · nem jelölhető');
    expect(describeDefectCell('maxilla', 'nonsense')).toBe('nonsense');
  });
});
