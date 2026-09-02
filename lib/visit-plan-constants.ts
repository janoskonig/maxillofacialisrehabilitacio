/**
 * Vizit-alapú kezelési terv — közös konstansok (szerver + kliens).
 *
 * A vizitek („alkalmak") közötti alapértelmezett lépésköz 1 hét. A munkafázisnak
 * magának NINCS saját várakozási ideje („cooldown"): egy alkalom fázisai egy
 * időpontra esnek, az időbeli távolságot kizárólag az alkalom `days_offset`-je
 * adja („ennyi nappal az előző alkalom után"). A fázis-szintű
 * `default_days_offset` oszlop csak legacy fallback (vizit nélküli sorok).
 */
export const DEFAULT_VISIT_GAP_DAYS = 7;

/** Gyors választó a vizitköz szerkesztőjéhez (napokban). */
export const VISIT_GAP_PRESETS_DAYS = [1, 2, 3, 7, 14, 21, 28] as const;

export function formatVisitGap(days: number): string {
  if (days === 0) return 'ugyanaznap';
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? '1 hét' : `${weeks} hét`;
  }
  return `${days} nap`;
}
