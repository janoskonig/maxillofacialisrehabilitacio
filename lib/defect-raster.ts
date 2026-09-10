/**
 * Raszterezett defektus-osztályozás (maxilla / mandibula).
 *
 * A Brown- (maxilla) és a Kovács–Dobák- (mandibula) osztályok helyett a
 * defektus KITERJEDÉSÉT jelöljük: egy-egy sematikus állcsontképre (okkluzális
 * nézet) fektetett rácson a klinikus bejelöli az érintett mezőket. A tárolt
 * érték a bejelölt mezők kulcsainak listája (pl. ["r2c1", "r2c2"]) — JSONB
 * tömb a `patient_anamnesis.maxilla_defektus_raszter` /
 * `mandibula_defektus_raszter` oszlopban (098-as migráció). A régi
 * `brown_*` / `kovacs_dobak_osztaly` oszlopok archívként megmaradnak, de az
 * űrlapon már nem szerkeszthetők.
 *
 * Koordináta-konvenció (az odontogram / FDI mintájára):
 *  - sorok (r0…r5) ELÖLRŐL hátrafelé: metszők → szemfog → kisőrlők →
 *    nagyőrlők → tuber (maxilla) / angulus (mandibula) → lágyszájpad / ramus;
 *  - oszlopok (c0…c7) a beteg JOBB oldalától (képernyőn bal) a BAL oldaláig:
 *    J4 J3 J2 J1 | B1 B2 B3 B4 — a középvonal a c3|c4 határ.
 *
 * A `zones` térkép mondja meg, mely mezők esnek csontra/szájpadra (anatómiai
 * zónakód) és melyek a rajzon kívülre ('.' — nem jelölhető). A térkép a
 * DefectRaster komponens sematikus rajzának geometriájából származik: az
 * ívek y = apex + a·|x−160|^2.6 alakúak (0…320 × 0…240-es rács-koordináták,
 * 40-es cellák); egy mező akkor jelölhető, ha legalább ~15 %-a csontra vagy
 * szájpadra esik, a zónakód a domináns szövet.
 */

export type DefectJaw = 'maxilla' | 'mandibula';

/** Anatómiai zónakódok a rács mezőihez. */
export type DefectZoneCode = 'A' | 'P' | 'S' | 'R' | 'C';

export interface DefectRasterLayout {
  jaw: DefectJaw;
  /** Megjelenített cím. */
  title: string;
  rows: number;
  cols: number;
  /** Rövid sor-címkék elölről hátrafelé (a rajz mellé). */
  rowLabels: readonly string[];
  /** Sor-leírások (tooltip, összegzés). */
  rowDescriptions: readonly string[];
  /** Oszlop-címkék a beteg jobb oldalától a bal oldaláig. */
  colLabels: readonly string[];
  /**
   * Zónatérkép: `rows` db, `cols` hosszú sor; betű = zónakód (jelölhető),
   * '.' = a csonton / szájpadon kívül eső, nem jelölhető mező.
   */
  zones: readonly string[];
  zoneLabels: Readonly<Partial<Record<DefectZoneCode, string>>>;
}

export const DEFECT_RASTER_ROWS = 6;
export const DEFECT_RASTER_COLS = 8;

const COL_LABELS = ['J4', 'J3', 'J2', 'J1', 'B1', 'B2', 'B3', 'B4'] as const;

/** A zónák megjelenítési sorrendje az összegzésben. */
const ZONE_ORDER: readonly DefectZoneCode[] = ['A', 'P', 'S', 'R', 'C'];

export const DEFECT_RASTER_LAYOUTS: Record<DefectJaw, DefectRasterLayout> = {
  maxilla: {
    jaw: 'maxilla',
    title: 'Maxilla',
    rows: DEFECT_RASTER_ROWS,
    cols: DEFECT_RASTER_COLS,
    rowLabels: ['Metszők', 'Szemfog', 'Kisőrlők', 'Nagyőrlők', 'Tuber', 'Lágyszájpad'],
    rowDescriptions: [
      'metszők szintje',
      'szemfog szintje',
      'kisőrlők szintje',
      'nagyőrlők szintje',
      'tuber maxillae szintje',
      'lágyszájpad',
    ],
    colLabels: COL_LABELS,
    zones: [
      '..AAAA..', // metszők: elülső alveolus
      '.AAPPAA.', // szemfog: alveolus + elülső szájpad (rugae)
      '.APPPPA.', // kisőrlők
      'AAPPPPAA', // nagyőrlők
      'APPPPPPA', // tuber + hátsó kemény szájpad
      '..SSSS..', // lágyszájpad (csak mediálisan)
    ],
    zoneLabels: { A: 'processus alveolaris', P: 'palatum durum', S: 'palatum molle' },
  },
  mandibula: {
    jaw: 'mandibula',
    title: 'Mandibula',
    rows: DEFECT_RASTER_ROWS,
    cols: DEFECT_RASTER_COLS,
    rowLabels: ['Metszők', 'Szemfog', 'Kisőrlők', 'Nagyőrlők', 'Angulus', 'Ramus'],
    rowDescriptions: [
      'metszők szintje (symphysis)',
      'szemfog szintje',
      'kisőrlők szintje',
      'nagyőrlők szintje',
      'angulus / retromoláris tájék',
      'ramus / condylus',
    ],
    colLabels: COL_LABELS,
    zones: [
      '..AAAA..', // symphysis
      '.AAAAAA.', // szemfog: a nyelvi oldal keskeny sávja is
      '.A....A.', // kisőrlők: a test egy mező széles
      'AA....AA', // nagyőrlők
      'RA....AR', // angulus (külső) + retromoláris alveolus (belső)
      'C......C', // ramus / condylus
    ],
    zoneLabels: {
      A: 'corpus / processus alveolaris',
      R: 'angulus mandibulae',
      C: 'ramus / condylus',
    },
  },
};

export function cellKey(row: number, col: number): string {
  return `r${row}c${col}`;
}

const CELL_KEY_RE = /^r(\d{1,2})c(\d{1,2})$/;

export function parseCellKey(key: unknown): { row: number; col: number } | null {
  if (typeof key !== 'string') return null;
  const m = CELL_KEY_RE.exec(key);
  if (!m) return null;
  return { row: Number(m[1]), col: Number(m[2]) };
}

/** A mező zónakódja, vagy `null`, ha a mező nem jelölhető / nem létezik. */
export function zoneAt(layout: DefectRasterLayout, row: number, col: number): DefectZoneCode | null {
  if (row < 0 || col < 0 || row >= layout.rows || col >= layout.cols) return null;
  const ch = layout.zones[row]?.[col];
  if (!ch || ch === '.') return null;
  return ch as DefectZoneCode;
}

export function isSelectableCell(layout: DefectRasterLayout, row: number, col: number): boolean {
  return zoneAt(layout, row, col) !== null;
}

/** Az összes jelölhető mező kulcsa sor-major sorrendben. */
export function selectableCellKeys(layout: DefectRasterLayout): string[] {
  const keys: string[] = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      if (isSelectableCell(layout, r, c)) keys.push(cellKey(r, c));
    }
  }
  return keys;
}

function compareCellKeys(a: string, b: string): number {
  const pa = parseCellKey(a);
  const pb = parseCellKey(b);
  if (!pa || !pb) return a.localeCompare(b);
  return pa.row - pb.row || pa.col - pb.col;
}

/**
 * Tetszőleges tárolt / beérkező érték → érvényes, deduplikált, sor-major
 * rendezett kulcslista. Elfogad tömböt és JSON-szöveget; az ismeretlen vagy
 * nem jelölhető mezőket eldobja (a szerver is ezzel normalizál mentés előtt).
 */
export function normalizeDefectRaster(jaw: DefectJaw, value: unknown): string[] {
  const layout = DEFECT_RASTER_LAYOUTS[jaw];
  let raw: unknown = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const set = new Set<string>();
  for (const item of raw) {
    const p = parseCellKey(item);
    if (p && isSelectableCell(layout, p.row, p.col)) set.add(cellKey(p.row, p.col));
  }
  return Array.from(set).sort(compareCellKeys);
}

export function isDefectRasterEmpty(jaw: DefectJaw, value: unknown): boolean {
  return normalizeDefectRaster(jaw, value).length === 0;
}

/** Egy mező be-/kikapcsolása; nem jelölhető mezőnél a lista változatlan. */
export function setDefectCell(
  jaw: DefectJaw,
  cells: unknown,
  key: string,
  selected: boolean
): string[] {
  const current = normalizeDefectRaster(jaw, cells);
  const p = parseCellKey(key);
  if (!p || !isSelectableCell(DEFECT_RASTER_LAYOUTS[jaw], p.row, p.col)) return current;
  const normalizedKey = cellKey(p.row, p.col);
  const has = current.includes(normalizedKey);
  if (selected === has) return current;
  return selected
    ? [...current, normalizedKey].sort(compareCellKeys)
    : current.filter((k) => k !== normalizedKey);
}

export function toggleDefectCell(jaw: DefectJaw, cells: unknown, key: string): string[] {
  const current = normalizeDefectRaster(jaw, cells);
  const p = parseCellKey(key);
  const has = !!p && current.includes(cellKey(p.row, p.col));
  return setDefectCell(jaw, current, key, !has);
}

export type DefectSide = 'jobb' | 'bal' | 'kétoldali';

export interface DefectRasterSummary {
  /** Bejelölt mezők száma. */
  count: number;
  /** Jelölhető mezők száma összesen. */
  total: number;
  /** count / total, egész százalék. */
  percent: number;
  side: DefectSide | null;
  /** Eléri-e a középvonal melletti (J1 / B1) mezőket. */
  reachesMidline: boolean;
  /** Mindkét oldalon van bejelölt mező (átlépi a középvonalat). */
  bilateral: boolean;
  zones: DefectZoneCode[];
  /** [legelülső sor, leghátsó sor] vagy null, ha üres. */
  rowRange: [number, number] | null;
  /** Ember által olvasható összegzés (a régi osztály-szöveg helyett). */
  text: string;
}

const SIDE_LABELS: Record<DefectSide, string> = {
  jobb: 'Jobb oldali',
  bal: 'Bal oldali',
  kétoldali: 'Kétoldali',
};

/**
 * A bejelölt mezők „osztályozás-szerű" összegzése: oldal, kiterjedés, érintett
 * anatómiai zónák, elülső–hátsó szint, középvonal. Tiszta függvény, a
 * kartonon és a kutatási exportban is ez a szöveg jelenik meg.
 */
export function summarizeDefectRaster(jaw: DefectJaw, value: unknown): DefectRasterSummary {
  const layout = DEFECT_RASTER_LAYOUTS[jaw];
  const cells = normalizeDefectRaster(jaw, value);
  const total = selectableCellKeys(layout).length;
  if (cells.length === 0) {
    return {
      count: 0,
      total,
      percent: 0,
      side: null,
      reachesMidline: false,
      bilateral: false,
      zones: [],
      rowRange: null,
      text: 'Nincs bejelölt mező.',
    };
  }

  const half = layout.cols / 2;
  let right = false;
  let left = false;
  let reachesMidline = false;
  const zoneSet = new Set<DefectZoneCode>();
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = -1;
  for (const key of cells) {
    const p = parseCellKey(key);
    if (!p) continue;
    if (p.col < half) right = true;
    else left = true;
    if (p.col === half - 1 || p.col === half) reachesMidline = true;
    const zone = zoneAt(layout, p.row, p.col);
    if (zone) zoneSet.add(zone);
    minRow = Math.min(minRow, p.row);
    maxRow = Math.max(maxRow, p.row);
  }

  const bilateral = right && left;
  const side: DefectSide = bilateral ? 'kétoldali' : right ? 'jobb' : 'bal';
  const zones = ZONE_ORDER.filter((z) => zoneSet.has(z));
  const percent = Math.round((cells.length / total) * 100);
  const rowText =
    minRow === maxRow
      ? layout.rowDescriptions[minRow]
      : `${layout.rowDescriptions[minRow]} – ${layout.rowDescriptions[maxRow]}`;

  const parts = [
    `${SIDE_LABELS[side]} defektus`,
    `${cells.length}/${total} mező (${percent}%)`,
    zones.map((z) => layout.zoneLabels[z]).filter(Boolean).join(', '),
    `szint: ${rowText}`,
  ];
  if (bilateral) parts.push('a középvonalat átlépi');
  else if (reachesMidline) parts.push('a középvonalig ér');

  return {
    count: cells.length,
    total,
    percent,
    side,
    reachesMidline,
    bilateral,
    zones,
    rowRange: [minRow, maxRow],
    text: parts.filter(Boolean).join(' · '),
  };
}

/** Egy mező leírása (tooltip / képernyőolvasó): „Nagyőrlők szintje · J2 · processus alveolaris". */
export function describeDefectCell(jaw: DefectJaw, key: string): string {
  const layout = DEFECT_RASTER_LAYOUTS[jaw];
  const p = parseCellKey(key);
  if (!p) return key;
  const zone = zoneAt(layout, p.row, p.col);
  const parts = [layout.rowDescriptions[p.row] ?? `sor ${p.row}`, layout.colLabels[p.col] ?? `oszlop ${p.col}`];
  if (zone) parts.push(layout.zoneLabels[zone] ?? zone);
  else parts.push('nem jelölhető');
  return parts.join(' · ');
}
