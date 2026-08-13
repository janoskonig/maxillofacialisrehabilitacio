/**
 * Fogfelszínek (felszín-szintű státusz az odontogramon).
 *
 * A grafikus nézet koronadoboza öt mezőből áll: négy trapéz (keret) + középső
 * mező. A rajz lokális koordináta-rendszerében ("gyökér felül") ezek a régiók
 * `top | bottom | left | right | center` néven érhetők el — hogy melyik régió
 * melyik anatómiai felszín, az a fog kvadránsától és állcsontjától függ:
 *
 *  - `top`    — a gyökér felőli oldal → mindig vesztibuláris (bukkális/labiális),
 *               mert az alsó fogaknál a rajzot függőlegesen tükrözzük, így a
 *               vesztibuláris felszín mindig az ív külső (középvonaltól távoli)
 *               oldalára esik.
 *  - `bottom` — orális (palatinális felül, lingvális alul)
 *  - `left`/`right` — meziális/disztális, a kvadránstól függően (az ív bal
 *               felén – 1/4/5/8 kvadráns – a középvonal jobbra van, tehát a
 *               meziális felszín a jobb oldali trapéz)
 *  - `center` — okkluzális (premoláris/moláris) vagy incizális (front)
 */

export type SurfaceKey = 'mesial' | 'distal' | 'vestibular' | 'oral' | 'occlusal';

/** Egy felszín jelölése. */
export type SurfaceMark = 'caries' | 'filling';

export type SurfaceMap = Partial<Record<SurfaceKey, SurfaceMark>>;

/** A rajz régiói a lokális ("gyökér felül") koordináta-rendszerben. */
export type SurfaceRegion = 'top' | 'bottom' | 'left' | 'right' | 'center';

export const SURFACE_KEYS: readonly SurfaceKey[] = [
  'occlusal',
  'mesial',
  'distal',
  'vestibular',
  'oral',
] as const;

export const SURFACE_MARKS: readonly SurfaceMark[] = ['caries', 'filling'] as const;

export const SURFACE_MARK_LABELS: Record<SurfaceMark, string> = {
  caries: 'Szuvas',
  filling: 'Tömött',
};

/** A felszín-jelölések színei (a ToothShapeChart is ezeket használja). */
export const SURFACE_MARK_COLORS: Record<SurfaceMark, string> = {
  caries: '#E07A2A',
  filling: '#3F76D8',
};

function quadrant(fdi: number | string): number {
  return Math.floor(Math.abs(Number(fdi)) / 10);
}

/** Felső állcsont-e (maradó 1x/2x és tej 5x/6x kvadránsok). */
export function isUpperJaw(fdi: number | string): boolean {
  const q = quadrant(fdi);
  return q === 1 || q === 2 || q === 5 || q === 6;
}

/** Az ív jobb oldala (a beteg jobb oldala) — 1/4/5/8 kvadráns. */
function isRightSide(fdi: number | string): boolean {
  const q = quadrant(fdi);
  return q === 1 || q === 4 || q === 5 || q === 8;
}

/** Front fog-e (metsző vagy szemfog) — az FDI-szám utolsó jegyéből. */
function isAnterior(fdi: number | string): boolean {
  const pos = Math.abs(Number(fdi)) % 10;
  return pos === 1 || pos === 2 || pos === 3;
}

/** Rajz-régió → anatómiai felszín az adott fogon. */
export function surfaceForRegion(fdi: number | string, region: SurfaceRegion): SurfaceKey {
  switch (region) {
    case 'top':
      return 'vestibular';
    case 'bottom':
      return 'oral';
    case 'center':
      return 'occlusal';
    case 'left':
      return isRightSide(fdi) ? 'distal' : 'mesial';
    case 'right':
      return isRightSide(fdi) ? 'mesial' : 'distal';
  }
}

/** Anatómiai felszín → rajz-régió az adott fogon. */
export function regionForSurface(fdi: number | string, key: SurfaceKey): SurfaceRegion {
  switch (key) {
    case 'vestibular':
      return 'top';
    case 'oral':
      return 'bottom';
    case 'occlusal':
      return 'center';
    case 'mesial':
      return isRightSide(fdi) ? 'right' : 'left';
    case 'distal':
      return isRightSide(fdi) ? 'left' : 'right';
  }
}

/** Felszín-név az adott fogra (front/oldalsó és felső/alsó szerint pontosítva). */
export function surfaceLabel(fdi: number | string, key: SurfaceKey): string {
  const anterior = isAnterior(fdi);
  switch (key) {
    case 'mesial':
      return 'Meziális';
    case 'distal':
      return 'Disztális';
    case 'vestibular':
      return anterior ? 'Labiális' : 'Bukkális';
    case 'oral':
      return isUpperJaw(fdi) ? 'Palatinális' : 'Lingvális';
    case 'occlusal':
      return anterior ? 'Incizális' : 'Okkluzális';
  }
}

/** Rövid jelölés a felszín-chipekhez (M, D, B/L, P/Li, O/I). */
export function surfaceShortLabel(fdi: number | string, key: SurfaceKey): string {
  const label = surfaceLabel(fdi, key);
  return label.charAt(0);
}

/** Kattintás-ciklus: ép → szuvas → tömött → ép. */
export function cycleSurfaceMark(current: SurfaceMark | undefined): SurfaceMark | undefined {
  if (!current) return 'caries';
  if (current === 'caries') return 'filling';
  return undefined;
}

/** Egy felszín beállítása (undefined = jelölés törlése) — új térképet ad vissza. */
export function setSurface(
  surfaces: SurfaceMap,
  key: SurfaceKey,
  mark: SurfaceMark | undefined
): SurfaceMap {
  const next: SurfaceMap = { ...surfaces };
  if (mark) next[key] = mark;
  else delete next[key];
  return next;
}

/** Tárolt (ismeretlen) érték → érvényes felszín-térkép. */
export function readSurfaces(value: unknown): SurfaceMap {
  if (!value || typeof value !== 'object') return {};
  const src = value as Record<string, unknown>;
  const out: SurfaceMap = {};
  for (const key of SURFACE_KEYS) {
    const mark = src[key];
    if (mark === 'caries' || mark === 'filling') out[key] = mark;
  }
  return out;
}

export function hasSurfaceMark(surfaces: SurfaceMap, mark: SurfaceMark): boolean {
  return SURFACE_KEYS.some((k) => surfaces[k] === mark);
}

export function countSurfaceMarks(surfaces: SurfaceMap): number {
  return SURFACE_KEYS.filter((k) => surfaces[k] != null).length;
}

/** Emberi olvasatú összefoglaló, pl. „szuvas: okkluzális, meziális". */
export function describeSurfaces(fdi: number | string, surfaces: SurfaceMap): string {
  const parts: string[] = [];
  for (const mark of SURFACE_MARKS) {
    const names = SURFACE_KEYS.filter((k) => surfaces[k] === mark).map((k) => surfaceLabel(fdi, k).toLowerCase());
    if (names.length) parts.push(`${SURFACE_MARK_LABELS[mark].toLowerCase()}: ${names.join(', ')}`);
  }
  return parts.join(' · ');
}
