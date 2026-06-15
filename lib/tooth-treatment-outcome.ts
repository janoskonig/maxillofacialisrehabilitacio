import type { ToothBase } from '@/hooks/usePatientAutoSave';

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
 * Kezeléskód → eredmény. A `csiszolás` szándékosan nincs benne: önmagában
 * (a végleges pótlás előtti előkészítés) nem változtatja a tárolt alapállapotot.
 */
export const TREATMENT_OUTCOME_RULES: Record<string, OutcomeRule> = {
  huzas: { base: 'missing', clearCaries: true, clearPeriapical: true, clearMobility: true },
  implantacio: { base: 'implant', clearCaries: true, clearPeriapical: true, clearMobility: true },
  korona: { base: 'crown', clearCaries: true },
  tomes: { base: 'filled', clearCaries: true },
  gyokerkezeles: { base: 'root_canal', clearPeriapical: true },
  hid_pillerkezeles: { base: 'bridge_abutment', clearCaries: true },
  csonk_felepites: { base: 'root_canal' },
  devitalizalas: { base: 'necrotic' },
};

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
}

function legacyStatusToBase(status?: string): ToothBase {
  if (status === 'M') return 'missing';
  if (status === 'F') return 'filled';
  return 'sound'; // 'D' (szuvas) → ép alap + caries
}

function resolveStored(value: unknown): ResolvedTooth {
  if (!value || typeof value === 'string') {
    return { base: 'sound', caries: false, periapical: false, mobility: 0, description: typeof value === 'string' && value.trim() ? value : undefined };
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
  };
}

/** Normalizált mezők → tárolható objektum (a default-tiszta fog `undefined`). */
function toStored(t: ResolvedTooth): Record<string, unknown> | undefined {
  const isDefault =
    t.base === 'sound' && !t.caries && !t.periapical && (!t.mobility || t.mobility === 0) && !t.description;
  if (isDefault) return undefined;
  const out: Record<string, unknown> = { base: t.base };
  if (t.caries) out.caries = true;
  if (t.periapical) out.periapical = true;
  if (t.mobility && t.mobility > 0) out.mobility = t.mobility;
  if (t.description) out.description = t.description;
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
