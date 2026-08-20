/**
 * Az odontogram alapállapotok (`ToothBase`) EGYETLEN forrása.
 *
 * Korábban két, kézzel szinkronban tartott másolat élt ugyanerre a listára:
 * a `ToothBase` union (hooks/usePatientAutoSave.ts) és a szerveroldali zod enum
 * (lib/types/patient.ts). Egy új alapállapot felvétele az egyikbe a másik nélkül
 * azt jelentette, hogy a kliens elküldi az értéket, a beteg-PUT validációja pedig
 * csendben elutasítja — a rajz sosem jelenik meg. (2026-08-15)
 *
 * Ez a modul szándékosan függőségmentes (nincs React, nincs DB-hozzáférés), hogy
 * a kliensoldali hook és a szerveroldali séma is importálhassa.
 */

export const TOOTH_BASES = [
  'sound',
  'missing',
  'filled',
  'crown',
  'root_canal',
  'inlay',
  'implant',
  'bridge_abutment',
  'bridge_pontic',
  'root_remnant',
  'impacted',
  'necrotic',
] as const;

/** Egy fog egy alapállapota (a `caries` ettől függetlenül rátehető). */
export type ToothBase = (typeof TOOTH_BASES)[number];
