/**
 * Heti klinikai cél (perc): König János 4 óra, Tasi Laura 4 óra, egyéb fogpótlástanász 2 óra.
 * A terhelés a foglalt idő és a horizontra vetített cél kapacitás hányadosa (~30 perc/időpont).
 */
export function getWeeklyTargetClinicalMinutes(doktorNeve: string): number {
  const n = doktorNeve
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (n.includes('konig') && n.includes('janos')) return 4 * 60;
  if (n.includes('tasi') && n.includes('laura')) return 4 * 60;
  return 2 * 60;
}

/** Cél kapacitás percben a megadott napokra: heti_cél × (horizonDays / 7). */
export function targetCapacityMinutesForHorizon(weeklyTargetMinutes: number, horizonDays: number): number {
  return (weeklyTargetMinutes * horizonDays) / 7;
}

export type DoctorWorkloadInputs = {
  doktorNeve: string;
  horizonDays: number;
  bookedMinutes: number;
  heldMinutes: number;
  wipCount: number;
  worklistCount: number;
  /** Naptárban megnyitott percek (csak „nem elérhető” jelzéshez). */
  availableMinutes: number;
};

/** Ugyanaz a súlyozás mint korábban: kihasználtság + tartás + várólista, a nevező a cél kapacitás. */
export function computeDoctorWorkloadScore(input: DoctorWorkloadInputs): {
  weeklyTargetMinutes: number;
  targetCapacityMinutes: number;
  utilization: number;
  holdPressure: number;
  pipelineNorm: number;
  busynessScore: number;
} {
  const weeklyTargetMinutes = getWeeklyTargetClinicalMinutes(input.doktorNeve);
  const targetCap = targetCapacityMinutesForHorizon(weeklyTargetMinutes, input.horizonDays);
  const denom = targetCap > 0 ? targetCap : 0;
  const utilization = denom > 0 ? input.bookedMinutes / denom : 0;
  const holdPressure = denom > 0 ? input.heldMinutes / denom : 0;
  const pipelineNorm = denom > 0 ? Math.min(1.5, (input.wipCount + input.worklistCount) * 30 / denom) : 0;
  const raw = 0.7 * utilization + 0.1 * holdPressure + 0.2 * pipelineNorm;
  const busynessScore = Math.round(100 * Math.min(raw, 1.5) / 1.5);
  return {
    weeklyTargetMinutes,
    targetCapacityMinutes: Math.round(targetCap),
    utilization,
    holdPressure,
    pipelineNorm,
    busynessScore,
  };
}
