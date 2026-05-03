/**
 * Migration 029 — kanonikus sablonok a sikertelen-jelölés indok-mezőjéhez.
 *
 * A `UnsuccessfulAttemptModal` ezeket kínálja chip-ként az orvosnak; a
 * `/api/admin/stats/unsuccessful-attempts` pedig ezekre csoportosítja a friss
 * adatok indok-szövegét, hogy a statisztika kompakt legyen (5 kanonikus
 * köteg + "Egyéb").
 *
 * A sablonok pontos szövege fontos — a stats API exact match-csel hasonlít
 * (case-insensitive trim után). Ha új sablont vesznek fel, a régi adatok
 * automatikusan az "Egyéb" kötegbe kerülnek; ha sablont MÓDOSÍTANAK, a régi
 * (eredeti szöveggel mentett) adatok az "Egyéb" kötegbe ugranak — szándékos
 * stabilitás-óvás.
 */

export const UNSUCCESSFUL_REASON_TEMPLATES = [
  'Lenyomat torzult / nem értékelhető',
  'Beteg nem tűrte (öklendezés / fájdalom)',
  'Anyagprobléma (keverés / kötés / előcsomag)',
  'Labor szerint hibás',
  'Nem maradt elég idő a kivitelezésre',
] as const;

export type UnsuccessfulReasonTemplate = (typeof UNSUCCESSFUL_REASON_TEMPLATES)[number];

/**
 * Egy szabad szövegű indokot az 5 kanonikus sablon valamelyikére képez le,
 * ha pontosan egyezik (case-insensitive, trim után). Ha egyetlen sablonra
 * sem illik, `null`-t ad vissza — ekkor a hívó az "Egyéb" kötegbe sorolja.
 */
export function matchReasonTemplate(reason: string | null | undefined): UnsuccessfulReasonTemplate | null {
  if (reason == null) return null;
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return null;
  for (const template of UNSUCCESSFUL_REASON_TEMPLATES) {
    if (template.toLowerCase() === normalized) return template;
  }
  return null;
}
