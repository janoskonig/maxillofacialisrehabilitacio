import type { ToothBase } from '@/lib/tooth-base';

/**
 * Odontogram alapállapot — egy fog egy alapállapota (a `caries` ettől függetlenül
 * rátehető). A lista forrása a `lib/tooth-base.ts`; itt csak re-exportáljuk, hogy a
 * meglévő `@/hooks/usePatientAutoSave` importok változatlanul működjenek.
 */
export type { ToothBase } from '@/lib/tooth-base';

export type ToothConditionObject = {
  /** Régi modell — visszafelé kompatibilitásra megtartva (D=szuvas, F=tömött, M=hiányzó). */
  status?: 'D' | 'F' | 'M';
  description?: string;
  /** Új odontogram modell. */
  base?: ToothBase;
  caries?: boolean;
  periapical?: boolean;
  /** Mozgathatóság fokozata: 0–3. */
  mobility?: number;
  /** Felszín-szintű státusz (meziális/disztális/vesztibuláris/orális/okkluzális). */
  surfaces?: Partial<Record<ToothSurfaceKey, ToothSurfaceMark>>;
};

export type ToothSurfaceKey = 'mesial' | 'distal' | 'vestibular' | 'oral' | 'occlusal';
export type ToothSurfaceMark = 'caries' | 'filling';

export type ToothStatus = ToothConditionObject | string;

export function normalizeToothData(
  value: ToothStatus | undefined
): ToothConditionObject | null {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    return { description: value };
  }
  if (typeof value === 'object' && value !== null) {
    const meaningful =
      value.status != null ||
      value.description !== undefined ||
      value.base != null ||
      value.caries === true ||
      value.periapical === true ||
      (value.mobility != null && value.mobility > 0) ||
      (value.surfaces != null && Object.keys(value.surfaces).length > 0);

    if (meaningful) return value;
    if (Object.keys(value).length === 0) return value;
    return null;
  }
  return value;
}

export function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  const t = typeof obj;
  if (t !== 'object') return JSON.stringify(obj);

  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }

  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = (obj as any)[k];
    parts.push(`${JSON.stringify(k)}:${stableStringify(v === undefined ? null : v)}`);
  }
  return `{${parts.join(',')}}`;
}
