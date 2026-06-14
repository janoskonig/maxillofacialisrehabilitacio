/**
 * Intake policy — pure decision logic for "can we take on a new patient?".
 *
 * Célfunkció: a rendszer azért van, hogy pontosan lássuk, mikor kezdhetünk új
 * beteget, nehogy tele legyünk félig kész páciensekkel (ami prolongálja a
 * kezeléseket és növeli a vizitszámot). Ezért a döntés KÉT terhelést néz:
 *
 *  1. busynessScore — a már LEFOGLALT (booked + hold) percek a heti penzumhoz
 *     vetítve. Ez a naptári nyomás a következő ~30 napban.
 *  2. backlogPct    — a félkész betegek MÉG LE NEM FOGLALT hátralévő munkája
 *     (a WP1 forecast remaining-visits becsléséből, percre váltva) a kapacitáshoz
 *     vetítve. Ez a "rejtett" terhelés, amit a puszta naptár nem mutat.
 *
 * A döntés mindig a szigorúbb tényezőt veszi → új beteg felvétele csak akkor
 * "GO", ha SEM a naptár, SEM a hátralévő munka nem terhel túl.
 */

import { targetCapacityMinutesForHorizon } from './doctor-clinical-target';

// ── Naptári foglaltság küszöbök (utilization %) ──────────────────────────────
export const INTAKE_STOP_BUSYNESS_PCT = 200; // ≥2× heti penzum → STOP
export const INTAKE_CAUTION_BUSYNESS_PCT = 150; // 1.5–2× → CAUTION

// ── Hátralévő-munka (backlog) küszöbök (a havi kapacitás %-ában) ─────────────
// 300% ≈ 3 hónapnyi még le nem foglalt hátralévő munka tornyosul → STOP.
// 200% ≈ 2 hónapnyi → CAUTION. Konzervatív alapértékek, hangolhatók.
export const INTAKE_STOP_BACKLOG_PCT = 300;
export const INTAKE_CAUTION_BACKLOG_PCT = 200;

// ── WIP-befejezési horizon küszöbök (nap) ────────────────────────────────────
export const INTAKE_STOP_WIP_DAYS = 28;
export const INTAKE_CAUTION_WIP_DAYS = 14;

/** Egy munkafázis-vizit becsült hossza percben — a remaining-visits → perc váltáshoz. */
export const AVG_WORK_VISIT_MINUTES = 60;

/**
 * A hátralévő (még le nem foglalt) vizitek terhelése a kapacitás %-ában.
 * remainingVisits × átlag vizithossz / (orvosszám × havi cél-kapacitás).
 * 0 orvos / 0 kapacitás esetén 0 (graceful).
 */
export function computeBacklogPct(
  remainingVisits: number,
  doctorCount: number,
  horizonDays: number
): number {
  const capacity = targetCapacityMinutesForHorizon(horizonDays) * Math.max(0, doctorCount);
  if (capacity <= 0) return 0;
  const backlogMinutes = Math.max(0, remainingVisits) * AVG_WORK_VISIT_MINUTES;
  return Math.round((backlogMinutes / capacity) * 100);
}

export interface IntakePolicyInput {
  /** Naptári foglaltság % (booked+hold / havi penzum). */
  busynessScore: number;
  /** Hátralévő le-nem-foglalt munka % (computeBacklogPct). */
  backlogPct: number;
  /** Nincs szabad slot, de van nyitott munka → kritikus. */
  nearCriticalIfNewStarts: boolean;
  /** A WIP P80 befejezési dátuma hány nap múlva van (null, ha nincs adat). */
  wipP80DaysFromNow: number | null;
}

export interface IntakePolicyResult {
  recommendation: 'GO' | 'CAUTION' | 'STOP';
  reasons: string[];
}

/**
 * Az intake-ajánlás tiszta kiértékelése. A szigorúbb tényező nyer; minden
 * kiváltó okot felsorol a reasons-ben (a UI ezeket jeleníti meg).
 */
export function evaluateIntakePolicy(input: IntakePolicyInput): IntakePolicyResult {
  const { busynessScore, backlogPct, nearCriticalIfNewStarts, wipP80DaysFromNow } = input;

  const busynessStop = busynessScore >= INTAKE_STOP_BUSYNESS_PCT;
  const backlogStop = backlogPct >= INTAKE_STOP_BACKLOG_PCT;
  const wipStop = wipP80DaysFromNow != null && wipP80DaysFromNow > INTAKE_STOP_WIP_DAYS;

  if (busynessStop || nearCriticalIfNewStarts || wipStop || backlogStop) {
    const reasons: string[] = [];
    if (busynessStop) reasons.push(`BUSYNESS_${busynessScore}`);
    if (nearCriticalIfNewStarts) reasons.push('NEAR_CRITICAL_IF_NEW_STARTS');
    if (wipStop) reasons.push(`WIP_P80_END_+${wipP80DaysFromNow}D`);
    if (backlogStop) reasons.push(`BACKLOG_${backlogPct}`);
    return { recommendation: 'STOP', reasons };
  }

  // STOP-ot már kizártuk → a >= caution küszöb itt elég (a felső sávot a STOP vitte).
  const busynessCaution = busynessScore >= INTAKE_CAUTION_BUSYNESS_PCT;
  const backlogCaution = backlogPct >= INTAKE_CAUTION_BACKLOG_PCT;
  const wipCaution = wipP80DaysFromNow != null && wipP80DaysFromNow > INTAKE_CAUTION_WIP_DAYS;

  if (busynessCaution || backlogCaution || wipCaution) {
    const reasons: string[] = [];
    if (busynessCaution) reasons.push(`BUSYNESS_${busynessScore}`);
    if (backlogCaution) reasons.push(`BACKLOG_${backlogPct}`);
    if (wipCaution) reasons.push(`WIP_P80_END_+${wipP80DaysFromNow}D`);
    return { recommendation: 'CAUTION', reasons };
  }

  return { recommendation: 'GO', reasons: ['OK'] };
}
