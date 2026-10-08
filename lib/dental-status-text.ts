/**
 * Fogazati státusz szerveroldali feloldása és szöveges leírása (PDF-export).
 *
 * Az odontogram feloldó logikája (`components/patient-form/odontogram/
 * tooth-conditions.ts`) futásidőben a `'use client'` jelölésű
 * `hooks/usePatientAutoSave.ts`-ből importál, ezért route handlerből nem
 * hívható. Ez a modul ugyanazt a feloldást adja függőségmentesen; a kettő
 * egyezését a `__tests__/lib/dental-status-text.test.ts` paritás-tesztje őrzi.
 */
import { TOOTH_BASES, type ToothBase } from '@/lib/tooth-base';
import {
  readSurfaces,
  hasSurfaceMark,
  describeSurfaces,
  type SurfaceMap,
} from '@/components/patient-form/odontogram/tooth-surfaces';

export interface ResolvedTooth {
  base: ToothBase;
  caries: boolean;
  periapical: boolean;
  mobility: number;
  description?: string;
  surfaces: SurfaceMap;
}

export const TOOTH_BASE_LABELS: Record<ToothBase, string> = {
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

const RESTORED: ToothBase[] = ['filled', 'crown', 'root_canal', 'inlay'];
const MOBILITY_ROMAN = ['', 'I', 'II', 'III'];

function isToothBase(value: unknown): value is ToothBase {
  return typeof value === 'string' && (TOOTH_BASES as readonly string[]).includes(value);
}

/**
 * Tárolt érték → feloldott állapot (a régi D/F/M és a szöveges érték is).
 * `null` = a fogról nincs rögzített adat.
 */
export function resolveTooth(value: unknown): ResolvedTooth | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const description = value.trim();
    if (!description) return null;
    return { base: 'sound', caries: false, periapical: false, mobility: 0, description, surfaces: {} };
  }
  if (typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const status = v.status;
  const base: ToothBase = isToothBase(v.base)
    ? v.base
    : status === 'M'
      ? 'missing'
      : status === 'F'
        ? 'filled'
        : 'sound'; // 'D' (szuvas) → ép alap + caries flag
  const caries = typeof v.caries === 'boolean' ? v.caries : status === 'D';
  const mobility = typeof v.mobility === 'number' && v.mobility > 0 ? Math.min(3, Math.round(v.mobility)) : 0;
  const description = typeof v.description === 'string' && v.description.trim() ? v.description.trim() : undefined;
  return {
    base,
    caries,
    periapical: v.periapical === true,
    mobility,
    description,
    surfaces: readSurfaces(v.surfaces),
  };
}

/** A természetes fog hiányzik-e (a hídtest és a műfog is hiányzó fogat jelöl). */
export function isToothMissing(t: ResolvedTooth): boolean {
  return t.base === 'missing' || t.base === 'bridge_pontic' || t.base === 'denture_tooth';
}

function supportsSurfaces(t: ResolvedTooth): boolean {
  return !isToothMissing(t) && t.base !== 'root_remnant' && t.base !== 'impacted';
}

function hasCaries(t: ResolvedTooth): boolean {
  return t.caries || hasSurfaceMark(t.surfaces, 'caries');
}

function hasFilling(t: ResolvedTooth): boolean {
  return RESTORED.includes(t.base) || hasSurfaceMark(t.surfaces, 'filling');
}

/** DMF-T index — ugyanaz a szabály, mint a felületen (`computeDMFT`). */
export function computeDentalDMFT(fogak: Record<string, unknown>): {
  d: number;
  m: number;
  f: number;
  dmft: number;
} {
  let d = 0;
  let m = 0;
  let f = 0;
  for (const value of Object.values(fogak)) {
    const t = resolveTooth(value);
    if (!t) continue;
    if (isToothMissing(t)) m++;
    else if (hasCaries(t)) d++;
    else if (hasFilling(t)) f++;
  }
  return { d, m, f, dmft: d + m + f };
}

/**
 * Egy fog olvasható leírása, pl. „Korona, szuvas: meziális, mobilitás: II – megjegyzés".
 * Üres string, ha a fogról nincs mit írni (nincs adat, vagy ép és megjegyzés nélküli).
 */
export function describeTooth(fdi: number | string, value: unknown): string {
  const t = resolveTooth(value);
  if (!t) return '';
  const parts: string[] = [];
  if (t.base !== 'sound') parts.push(TOOTH_BASE_LABELS[t.base]);
  const surfaces = supportsSurfaces(t) ? t.surfaces : {};
  // A fog-szintű jelölő csak akkor kell külön, ha a felszín-leírás nem mondja ki.
  if (t.caries && !hasSurfaceMark(surfaces, 'caries')) parts.push('Szuvas');
  const surfaceText = describeSurfaces(fdi, surfaces);
  if (surfaceText) parts.push(...surfaceText.split(' · '));
  if (t.periapical) parts.push('Gyökércsúcsi gyulladás');
  if (t.mobility > 0) parts.push(`Mobilitás: ${MOBILITY_ROMAN[t.mobility]}`);
  const findings = parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p.charAt(0).toLowerCase() + p.slice(1))).join(', ');
  if (findings && t.description) return `${findings} – ${t.description}`;
  return findings || t.description || '';
}
