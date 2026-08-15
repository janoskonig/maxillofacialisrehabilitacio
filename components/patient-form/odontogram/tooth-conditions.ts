import {
  normalizeToothData,
  type ToothStatus,
  type ToothBase,
} from '@/hooks/usePatientAutoSave';
import {
  readSurfaces,
  hasSurfaceMark,
  countSurfaceMarks,
  type SurfaceMap,
} from './tooth-surfaces';

export type ToothGroup = 'incisor' | 'canine' | 'premolar' | 'molar';

/** Egy fog feloldott állapota (a legacy D/F/M is ide normalizálódik). */
export interface ToothConditions {
  base: ToothBase;
  caries: boolean;
  periapical: boolean;
  mobility: number;
  description?: string;
  /** Felszín-szintű jelölések (hiányzó/üres térkép = nincs felszín-adat). */
  surfaces?: SurfaceMap;
}

export const UPPER_ROW = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_ROW = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const UPPER_TEETH = UPPER_ROW.map(String);
export const LOWER_TEETH = LOWER_ROW.map(String);

/** Fogcsoport az FDI-szám utolsó jegyéből. */
export function toothGroup(fdi: number | string): ToothGroup {
  const pos = Math.abs(Number(fdi)) % 10;
  if (pos === 1 || pos === 2) return 'incisor';
  if (pos === 3) return 'canine';
  if (pos === 4 || pos === 5) return 'premolar';
  return 'molar';
}

function baseFromLegacyStatus(status?: 'D' | 'F' | 'M'): ToothBase {
  if (status === 'M') return 'missing';
  if (status === 'F') return 'filled';
  return 'sound'; // 'D' (szuvas) → ép alap + caries flag
}

/** Tárolt érték → feloldott állapot, a régi D/F/M kezelésével. */
export function readConditions(value: ToothStatus | undefined): ToothConditions {
  const norm = normalizeToothData(value);
  if (!norm) {
    return { base: 'sound', caries: false, periapical: false, mobility: 0, surfaces: {} };
  }
  const base = norm.base ?? baseFromLegacyStatus(norm.status);
  const caries = norm.caries ?? norm.status === 'D';
  return {
    base,
    caries: Boolean(caries),
    periapical: Boolean(norm.periapical),
    mobility: norm.mobility ?? 0,
    description: norm.description,
    surfaces: readSurfaces(norm.surfaces),
  };
}

/** A felszín-jelölések a fogon (mindig érvényes térkép). */
export function surfacesOf(c: ToothConditions): SurfaceMap {
  return c.surfaces ?? {};
}

/**
 * Van-e szuvasodás a fogon: a fog-szintű jelölő VAGY bármelyik felszín szuvas.
 * A megjelenítés és a DMF-T is ezt használja, hogy a két adatfelvételi mód
 * (gyors jelölő / felszín-szintű) ne mondjon ellent egymásnak.
 */
export function hasCaries(c: ToothConditions): boolean {
  return c.caries || hasSurfaceMark(surfacesOf(c), 'caries');
}

/** Van-e tömés a fogon (alapállapot vagy felszín-szintű jelölés alapján). */
export function hasFilling(c: ToothConditions): boolean {
  return RESTORED.includes(c.base) || hasSurfaceMark(surfacesOf(c), 'filling');
}

/** Értelmezhetők-e felszínek ezen a fogon (hiányzó / gyökérmaradvány / retineált nem). */
export function supportsSurfaces(base: ToothBase): boolean {
  return !isMissingBase(base) && base !== 'root_remnant' && base !== 'impacted';
}

/** Feloldott állapot → tárolható objektum (üres → undefined, hogy ki lehessen törölni). */
export function writeConditions(c: ToothConditions): ToothStatus | undefined {
  // A hiányzó/roncs fogakon nincs értelmezhető felszín — ne tároljunk holt adatot.
  const surfaces = supportsSurfaces(c.base) ? surfacesOf(c) : {};
  const surfaceCount = countSurfaceMarks(surfaces);
  const isDefault =
    c.base === 'sound' &&
    !c.caries &&
    !c.periapical &&
    (!c.mobility || c.mobility === 0) &&
    !c.description &&
    surfaceCount === 0;
  if (isDefault) return undefined;
  const out: ToothStatus = { base: c.base };
  if (c.caries) out.caries = true;
  if (c.periapical) out.periapical = true;
  if (c.mobility && c.mobility > 0) out.mobility = c.mobility;
  if (c.description) out.description = c.description;
  if (surfaceCount > 0) out.surfaces = surfaces;
  return out;
}

/**
 * A természetes fog hiányzik-e. A hídtest és a kivehető pótlás műfoga is hiányzó
 * természetes fogat jelöl — a pótlás nem tesz vissza fogat, csak kitölti a helyét.
 * Ezen múlik, hogy a DMF-T és az ív-összegzés helyes marad-e.
 */
export function isMissingBase(base: ToothBase): boolean {
  return base === 'missing' || base === 'bridge_pontic' || base === 'denture_tooth';
}

export function isPresent(c: ToothConditions): boolean {
  return !isMissingBase(c.base);
}

export const BASE_LABELS: Record<ToothBase, string> = {
  sound: 'Ép',
  missing: 'Hiányzó',
  filled: 'Tömött',
  crown: 'Korona',
  root_canal: 'Gyökértömött',
  inlay: 'Inlay / onlay',
  implant: 'Implantátum',
  bridge_abutment: 'Horgonykorona',
  bridge_pontic: 'Hídtest',
  root_remnant: 'Gyökérmaradvány',
  impacted: 'Retineált / nem tört elő',
  necrotic: 'Nekrotizált pulpa',
  denture_tooth: 'Műfog (kivehető pótlás)',
};

/** Az editorban felkínált alapállapotok sorrendje. */
export const BASE_OPTIONS: ToothBase[] = [
  'sound',
  'missing',
  'filled',
  'crown',
  'root_canal',
  'inlay',
  'implant',
  'bridge_abutment',
  'bridge_pontic',
  'denture_tooth',
  'root_remnant',
  'impacted',
  'necrotic',
];

const RESTORED: ToothBase[] = ['filled', 'crown', 'root_canal', 'inlay'];

/** DMF-T index a feloldott állapotokból. */
export function computeDMFT(fogak: Record<string, ToothStatus>): {
  d: number;
  m: number;
  f: number;
  dmft: number;
} {
  let d = 0;
  let m = 0;
  let f = 0;
  for (const value of Object.values(fogak)) {
    const c = readConditions(value);
    if (isMissingBase(c.base)) {
      m++;
    } else if (hasCaries(c)) {
      d++;
    } else if (hasFilling(c)) {
      f++;
    }
  }
  return { d, m, f, dmft: d + m + f };
}

/** Rövid összegzés egy ívre (megvan / hiányzó). */
export function archSummary(
  fogak: Record<string, ToothStatus>,
  teeth: string[]
): { present: number; missing: number } {
  let present = 0;
  let missing = 0;
  for (const t of teeth) {
    const c = readConditions(fogak[t]);
    if (isMissingBase(c.base)) missing++;
    else present++;
  }
  return { present, missing };
}
