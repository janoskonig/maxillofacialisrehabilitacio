import type { ToothBase, ToothSurfaceKey, ToothSurfaceMark } from '@/hooks/usePatientAutoSave';

type SurfaceMap = Partial<Record<ToothSurfaceKey, ToothSurfaceMark>>;

const SURFACE_KEYS: ToothSurfaceKey[] = ['occlusal', 'mesial', 'distal', 'vestibular', 'oral'];

/**
 * Egy elkészült fogkezelés következménye az adott fog odontogram-állapotára.
 *
 * Tárolási oldalon a fog állapota a `patient_dental_status.meglevo_fogak`
 * JSONB-ben él, fogszámra kulcsolva. Ez a modul tisztán (DB nélkül) számolja ki,
 * hogy egy kezelés "Kész"-re állításakor mivé válik a fog alapállapota, hogy a
 * Zsigmondy-státusz és az idővonal automatikusan kövesse a tényleges kezelést.
 */

/** A `tooth_treatment_catalog.code`-hoz tartozó eredmény-alapállapot. */
interface OutcomeRule {
  base: ToothBase;
  /** A szuvasodás-jelzőt törölje (a beavatkozás megszüntette a léziót). */
  clearCaries?: boolean;
  /** A periapikális jelzőt törölje (kezelt). */
  clearPeriapical?: boolean;
  /** A mozgathatóságot nullázza (pl. extrakció / implantátum). */
  clearMobility?: boolean;
}

/**
 * Kezeléskód → eredmény.
 *
 * Az érték **explicit `null`**, ha a kód szándékosan nem változtatja a tárolt
 * alapállapotot (pl. a csiszolás önmagában a végleges pótlás előtti előkészítés).
 * Ez nem stiláris döntés: a katalógus-lefedettség ellenőrzője (lib/catalog-coverage.ts)
 * a registry KULCSAIT veti össze a `tooth_treatment_catalog` sorokkal. Ha a
 * „nincs hatás" eset kulcs nélküli hiányként jelenne meg, ezek a kódok állandó
 * hamis riasztást adnának — így viszont a `null` egy kimondott, felülvizsgálható
 * döntés, és tényleg csak a registryből teljesen hiányzó kód számít hiánynak.
 * (2026-08-15)
 */
export const TREATMENT_OUTCOME_RULES: Record<string, OutcomeRule | null> = {
  huzas: { base: 'missing', clearCaries: true, clearPeriapical: true, clearMobility: true },
  implantacio: { base: 'implant', clearCaries: true, clearPeriapical: true, clearMobility: true },
  korona: { base: 'crown', clearCaries: true },
  tomes: { base: 'filled', clearCaries: true },
  gyokerkezeles: { base: 'root_canal', clearPeriapical: true },
  hid_pillerkezeles: { base: 'bridge_abutment', clearCaries: true },
  csonk_felepites: { base: 'root_canal' },
  devitalizalas: { base: 'necrotic' },
  // Protetikai szerepek (079-es migráció). A hézagfog és a műfog hiányzó
  // természetes fog helyére kerül, ezért a fog-szintű jelzők törlődnek.
  hezagfog: { base: 'bridge_pontic', clearCaries: true, clearPeriapical: true, clearMobility: true },
  mufog: { base: 'denture_tooth', clearCaries: true, clearPeriapical: true, clearMobility: true },
  kapocstarto_korona: { base: 'crown', clearCaries: true },

  // Szándékosan nincs odontogram-hatás — az igény rögzül és a fogankénti listában
  // látszik, de az alapállapotot nem írja át.
  csiszolas: null,
  /** A kapocs a pótláson van, a támfog maga nem változik. */
  kapocstarto_tamfog: null,
  /** A rejtett elhorgonyzási elem a pótlás része, nem a fog alapállapota. */
  rejtett_elhorgonyzas: null,
};

/**
 * Minden ismert kezeléskód — beleértve a szándékosan hatás nélkülieket is.
 * A katalógus-lefedettség ellenőrzője ezt használja referenciahalmazként.
 */
export const KNOWN_TREATMENT_CODES: readonly string[] = Object.keys(TREATMENT_OUTCOME_RULES);

/** Az adott kezeléskód eredmény-alapállapota, vagy null, ha nincs automatikus váltás. */
export function outcomeBaseFor(code: string): ToothBase | null {
  return TREATMENT_OUTCOME_RULES[code]?.base ?? null;
}

/** Tárolt fogérték (legacy string / D-F-M / objektum) normalizált mezőire bontva. */
interface ResolvedTooth {
  base: ToothBase;
  caries: boolean;
  periapical: boolean;
  mobility: number;
  description?: string;
  surfaces: SurfaceMap;
}

function resolveSurfaces(value: unknown): SurfaceMap {
  if (!value || typeof value !== 'object') return {};
  const src = value as Record<string, unknown>;
  const out: SurfaceMap = {};
  for (const key of SURFACE_KEYS) {
    const mark = src[key];
    if (mark === 'caries' || mark === 'filling') out[key] = mark;
  }
  return out;
}

/**
 * A felszín-jelölések sorsa a kezelés után:
 *  - a fog megszűnik / teljesen fedetté válik (extrakció, implantátum, korona,
 *    hídpillér) → nincs értelmezhető felszín-adat,
 *  - a szuvasodást megszüntető, de felszín-szintű beavatkozás (tömés) → a szuvas
 *    felszínekből tömött felszín lesz,
 *  - egyébként változatlan.
 */
function nextSurfaces(current: SurfaceMap, rule: OutcomeRule): SurfaceMap {
  const covered =
    rule.base === 'missing' ||
    rule.base === 'implant' ||
    rule.base === 'crown' ||
    rule.base === 'bridge_abutment' ||
    rule.base === 'bridge_pontic' ||
    rule.base === 'denture_tooth';
  if (covered) return {};
  if (!rule.clearCaries) return { ...current };
  const out: SurfaceMap = {};
  for (const key of SURFACE_KEYS) {
    const mark = current[key];
    if (mark === 'caries') out[key] = 'filling';
    else if (mark) out[key] = mark;
  }
  return out;
}

function legacyStatusToBase(status?: string): ToothBase {
  if (status === 'M') return 'missing';
  if (status === 'F') return 'filled';
  return 'sound'; // 'D' (szuvas) → ép alap + caries
}

function resolveStored(value: unknown): ResolvedTooth {
  if (!value || typeof value === 'string') {
    return { base: 'sound', caries: false, periapical: false, mobility: 0, description: typeof value === 'string' && value.trim() ? value : undefined, surfaces: {} };
  }
  const v = value as Record<string, unknown>;
  const status = typeof v.status === 'string' ? v.status : undefined;
  const base = (typeof v.base === 'string' ? v.base : undefined) as ToothBase | undefined;
  return {
    base: base ?? legacyStatusToBase(status),
    caries: v.caries === true || status === 'D',
    periapical: v.periapical === true,
    mobility: typeof v.mobility === 'number' ? v.mobility : 0,
    description: typeof v.description === 'string' ? v.description : undefined,
    surfaces: resolveSurfaces(v.surfaces),
  };
}

/** Normalizált mezők → tárolható objektum (a default-tiszta fog `undefined`). */
function toStored(t: ResolvedTooth): Record<string, unknown> | undefined {
  const surfaceCount = SURFACE_KEYS.filter((k) => t.surfaces[k] != null).length;
  const isDefault =
    t.base === 'sound' &&
    !t.caries &&
    !t.periapical &&
    (!t.mobility || t.mobility === 0) &&
    !t.description &&
    surfaceCount === 0;
  if (isDefault) return undefined;
  const out: Record<string, unknown> = { base: t.base };
  if (t.caries) out.caries = true;
  if (t.periapical) out.periapical = true;
  if (t.mobility && t.mobility > 0) out.mobility = t.mobility;
  if (t.description) out.description = t.description;
  if (surfaceCount > 0) out.surfaces = t.surfaces;
  return out;
}

/**
 * Egy elkészült kezelés következményét egy fog tárolt állapotára alkalmazza.
 * Bármilyen tárolt alakot elfogad; normalizált objektumot (vagy `undefined`-et,
 * ha az eredmény default-tiszta) ad vissza, és jelzi, hogy változott-e.
 */
export function applyTreatmentOutcome(
  current: unknown,
  treatmentCode: string,
): { changed: boolean; next: Record<string, unknown> | undefined } {
  const rule = TREATMENT_OUTCOME_RULES[treatmentCode];
  const resolved = resolveStored(current);
  if (!rule) return { changed: false, next: toStored(resolved) };

  const next: ResolvedTooth = {
    base: rule.base,
    caries: rule.clearCaries ? false : resolved.caries,
    periapical: rule.clearPeriapical ? false : resolved.periapical,
    mobility: rule.clearMobility ? 0 : resolved.mobility,
    description: resolved.description,
    surfaces: nextSurfaces(resolved.surfaces, rule),
  };

  const before = toStored(resolved);
  const after = toStored(next);
  const changed = JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
  return { changed, next: after };
}

/**
 * A teljes odontogram-térkép célállapota, ha a megadott kezeléseket elkészültnek
 * vesszük (a "kezelési terv" overlay-hez). A bemeneti térképet nem módosítja.
 */
export function projectFogakWithTreatments(
  fogak: Record<string, unknown>,
  treatments: Array<{ toothNumber: number | string; treatmentCode: string }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fogak };
  for (const t of treatments) {
    const key = String(t.toothNumber);
    const { next } = applyTreatmentOutcome(out[key], t.treatmentCode);
    if (next === undefined) delete out[key];
    else out[key] = next;
  }
  return out;
}
