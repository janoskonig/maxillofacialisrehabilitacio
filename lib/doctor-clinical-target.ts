/**
 * Heti klinikai penzum (perc): mindenkinek 2 óra. Nincs név alapú kivétel.
 *
 * A terhelési pontszám transzparens és csak a foglalt (committed) percek és a
 * heti célhoz vetített cél kapacitás alapján számol – a naptár (felkínált
 * percek) ezen a ponton nem mozgatja a score-t, csak külön mutatóként jelenik
 * meg a felületen.
 */

/** Heti klinikai cél perc – mindenkinek 2 óra. */
export const WEEKLY_TARGET_CLINICAL_MINUTES = 2 * 60;

/** Cél kapacitás percben a megadott napokra: heti_cél × (horizonDays / 7). */
export function targetCapacityMinutesForHorizon(horizonDays: number): number {
  return (WEEKLY_TARGET_CLINICAL_MINUTES * horizonDays) / 7;
}

export type DoctorWorkloadInputs = {
  horizonDays: number;
  /** Véglegesen lefoglalt percek a horizonton belül (jövőbeli, nem held). */
  bookedMinutes: number;
  /** Aktív hold-on lévő percek (még tartott, nem véglegesített foglalás). */
  heldMinutes: number;
};

export type WorkloadLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Szint küszöbök a kapott utilizationPct-hez (foglalt / cél × 100).
 *
 * <50%   → alacsony  (a heti penzum felénél kevesebb)
 * 50–100 → közepes   (a heti penzum körüli)
 * 100–200 → magas    (1–2× heti penzum)
 * >200%  → kritikus  (több mint 2× heti penzum)
 */
export function getLevelFromUtilization(utilizationPct: number): WorkloadLevel {
  if (utilizationPct < 50) return 'low';
  if (utilizationPct < 100) return 'medium';
  if (utilizationPct <= 200) return 'high';
  return 'critical';
}

export type DoctorWorkloadResult = {
  weeklyTargetMinutes: number;
  targetCapacityMinutes: number;
  committedMinutes: number;
  utilizationPct: number;
  level: WorkloadLevel;
};

/**
 * Pontszám a (foglalt + hold) percek és a heti penzumból számolt cél kapacitás
 * hányadosából. NINCS felső korlát – a tényleges arány látszik (akár 500% is).
 */
export function computeDoctorWorkloadScore(input: DoctorWorkloadInputs): DoctorWorkloadResult {
  const targetCapacityMinutes = targetCapacityMinutesForHorizon(input.horizonDays);
  const committedMinutes = Math.max(0, input.bookedMinutes) + Math.max(0, input.heldMinutes);
  const utilizationPct = targetCapacityMinutes > 0
    ? Math.round((committedMinutes / targetCapacityMinutes) * 100)
    : 0;
  return {
    weeklyTargetMinutes: WEEKLY_TARGET_CLINICAL_MINUTES,
    targetCapacityMinutes: Math.round(targetCapacityMinutes),
    committedMinutes,
    utilizationPct,
    level: getLevelFromUtilization(utilizationPct),
  };
}
