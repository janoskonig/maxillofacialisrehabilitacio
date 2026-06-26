/**
 * Stádium-kód → megjelenítés (címke + Tailwind-osztályok) az egyesített
 * „betegút" idővonal háttérsávjához. A kódok a `lib/types/episode.ts` /
 * `lib/legacy-patient-stage-map.ts` taxonómiáját követik:
 *   STAGE_0 Új beteg · STAGE_2 Árajánlatra vár · STAGE_5 Fogpótlás készül ·
 *   STAGE_6 Fogpótlás kész · STAGE_7 Gondozás alatt (terminális).
 * A szín a klinikai előrehaladást tükrözi (szürke → borostyán → kék → teal).
 */
export interface StageDisplay {
  label: string;
  /** Háttérsáv kitöltése (halvány, hogy a lépés-jelek kiemelkedjenek rajta). */
  band: string;
  /** Címke/badge szövegszín. */
  text: string;
  /** Badge háttér (a bal sávban). */
  badge: string;
}

// A label-ek a stage_catalog (code+reason) szerinti label_hu fallback-jai — a
// tényleges szöveg az API-ból (StageInterval.label / currentStageLabel) jön.
// A színek a klinikai előrehaladást tükrözik (szürke → borostyán → kék → zöld).
const STAGE_DISPLAY: Record<string, StageDisplay> = {
  STAGE_0: { label: 'Első konzultációra vár', band: 'bg-slate-200 dark:bg-slate-600/70', text: 'text-slate-700 dark:text-slate-100', badge: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200' },
  STAGE_1: { label: 'Státuszfelvétel + dokumentáció', band: 'bg-slate-200 dark:bg-slate-600/70', text: 'text-slate-700 dark:text-slate-100', badge: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200' },
  STAGE_2: { label: 'Terv & árajánlat készül / egyeztetés', band: 'bg-amber-200 dark:bg-amber-700/60', text: 'text-amber-900 dark:text-amber-100', badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200' },
  STAGE_3: { label: 'Elfogadva / finanszírozás-rendelés előkészítés', band: 'bg-amber-200 dark:bg-amber-700/60', text: 'text-amber-900 dark:text-amber-100', badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200' },
  STAGE_4: { label: 'Sebészi fázis folyamatban (ha van)', band: 'bg-indigo-200 dark:bg-indigo-700/60', text: 'text-indigo-900 dark:text-indigo-100', badge: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200' },
  STAGE_5: { label: 'Protetikai fázis folyamatban', band: 'bg-sky-200 dark:bg-sky-700/60', text: 'text-sky-900 dark:text-sky-100', badge: 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200' },
  STAGE_6: { label: 'Átadás megtörtént', band: 'bg-emerald-200 dark:bg-emerald-700/60', text: 'text-emerald-900 dark:text-emerald-100', badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200' },
  STAGE_7: { label: 'Gondozás / kontroll', band: 'bg-slate-300 dark:bg-slate-600/70', text: 'text-slate-700 dark:text-slate-100', badge: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200' },
};

const FALLBACK: StageDisplay = {
  label: '—',
  band: 'bg-slate-200 dark:bg-slate-600/70',
  text: 'text-slate-700 dark:text-slate-100',
  badge: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200',
};

export function stageDisplay(code: string | null | undefined): StageDisplay {
  if (!code) return FALLBACK;
  return STAGE_DISPLAY[code] ?? { ...FALLBACK, label: code };
}
