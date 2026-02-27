/**
 * Becsült legkorábbi elkészülési napok a kezeléstípus (treatment_types.code) alapján.
 * A technikum gyártási időkre vonatkozó durva becslés; igény szerint módosítható.
 */
const ESTIMATED_DAYS_BY_CODE: Record<string, number> = {
  zarolemez: 10,
  reszleges_akrilat: 14,
  teljes_lemez: 21,
  fedolemezes: 14,
  kapocselhorgonyzasu_reszleges: 21,
  kombinalt_kapoccsal: 21,
  kombinalt_rejtett: 21,
  rogzitett_fogakon: 14,
  cementezett_implant: 28,
  csavarozott_implant: 28,
  sebeszi_sablon: 14,
};

const DEFAULT_ESTIMATED_DAYS = 14;

/**
 * Visszaadja a típus alapján a becsült napok számát (ma + ennyi nap = legkorábbi elkészülési dátum).
 */
export function getEstimatedDaysToReady(treatmentTypeCode: string | null | undefined): number {
  if (!treatmentTypeCode || typeof treatmentTypeCode !== 'string') return DEFAULT_ESTIMATED_DAYS;
  const trimmed = treatmentTypeCode.trim();
  if (!trimmed) return DEFAULT_ESTIMATED_DAYS;
  return ESTIMATED_DAYS_BY_CODE[trimmed] ?? DEFAULT_ESTIMATED_DAYS;
}

/**
 * Kiszámolja a legkorábbi elkészülési dátumot (ma + becsült napok).
 * @returns YYYY-MM-DD vagy null ha nem számolható
 */
export function getEarliestReadyDate(treatmentTypeCode: string | null | undefined): string | null {
  const days = getEstimatedDaysToReady(treatmentTypeCode);
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formázás megjelenítésre (pl. 2025. 03. 15.)
 */
export function formatEarliestReadyDisplay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${y}. ${m}. ${d}.`;
}
