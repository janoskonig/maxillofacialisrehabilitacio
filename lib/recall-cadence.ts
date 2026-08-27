/**
 * Gondozási (recall) kadencia-katalógus rizikószintenként — PURE modul,
 * DB és framework nélkül tesztelhető (WP-3.2).
 *
 * FIGYELEM — a konkrét napszámok JAVASLATOK: élesítés (a rizikószint-választó
 * UI bekapcsolása) előtt a felhasználó (gyakorló orvos) jóváhagyása szükséges.
 * Rizikószint nélkül (NULL) a rendszer a mai viselkedést adja: a 'low'
 * kadenciát, azaz 180 + 365 nap.
 */

export type RecallRiskLevel = 'low' | 'medium' | 'high';

export const RECALL_RISK_LEVELS: readonly RecallRiskLevel[] = ['low', 'medium', 'high'];

/**
 * Javasolt kadencia rizikószintenként, az utolsó teljesült kezeléstől/
 * kontrolltól számított napokban. A számok a felhasználó jóváhagyásáig
 * javaslatnak tekintendők (lásd a modul-fejlécet).
 */
export const RECALL_CADENCE_DAYS: Record<RecallRiskLevel, readonly number[]> = {
  low: [180, 365],
  medium: [90, 180, 365],
  high: [30, 90, 180, 365],
};

export function isRecallRiskLevel(value: unknown): value is RecallRiskLevel {
  return typeof value === 'string' && (RECALL_RISK_LEVELS as readonly string[]).includes(value);
}

/** NULL / ismeretlen érték → 'low' (a mai viselkedés). */
export function normalizeRecallRiskLevel(value: unknown): RecallRiskLevel {
  return isRecallRiskLevel(value) ? value : 'low';
}

export function recallCadenceForRisk(value: unknown): readonly number[] {
  return RECALL_CADENCE_DAYS[normalizeRecallRiskLevel(value)];
}

/**
 * Emberi címke egy recall-intervallumhoz. A 088-as migráció backfillje és az
 * auto-generálás is ezzel konzisztens címkét ír (180 → „6 hónapos kontroll").
 */
export function recallLabelForInterval(days: number): string {
  if (days > 0 && days % 365 === 0) return `${(days / 365) * 12} hónapos kontroll`;
  if (days > 0 && days % 30 === 0) return `${days / 30} hónapos kontroll`;
  if (days > 0 && days % 7 === 0) return `${days / 7} hetes kontroll`;
  return `${days} napos kontroll`;
}
