import { OHIP14_TIMEPOINTS, type OHIP14Timepoint } from './types';

// ── Window constants (days relative to delivery date) ─────────────────
//
// Each delivery-relative timepoint becomes fillable on its OPEN day and stays
// fillable until the NEXT timepoint opens (T5 has no successor → stays open
// indefinitely). This removes the gaps that used to exist between windows and
// guarantees that a skipped earlier timepoint never blocks a later one: when a
// later window opens, it is fillable regardless of whether the earlier ones
// were completed.
//
// The delivery date is the first stage event at/after "Átadás megtörtént"
// (STAGE_6) — a patient moved straight to STAGE_7 also starts the clock
// (lib/ohip14-stage.ts getDeliveryDate).
const OPEN_DAYS: Record<Exclude<OHIP14Timepoint, 'T0'>, number> = {
  T1: 0,     // immediately at delivery
  T2: 30,    // 1 month after delivery
  T3: 180,   // 6 months after delivery
  T4: 365,   // 1 year after delivery
  T5: 1095,  // 3 years after delivery
};

// The timepoint whose opening closes the current one's window (null = open-ended).
const NEXT_TIMEPOINT: Record<Exclude<OHIP14Timepoint, 'T0'>, Exclude<OHIP14Timepoint, 'T0'> | null> = {
  T1: 'T2',
  T2: 'T3',
  T3: 'T4',
  T4: 'T5',
  T5: null,
};

// T0 is allowed for these stages (before prosthetic phase)
const T0_ALLOWED_STAGES = ['STAGE_0', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4'];

// ── Legacy mappings (kept for backward compatibility with patient_current_stage) ──
export const LEGACY_OHIP_TIMEPOINT_STAGES: Record<'T0', string> = {
  T0: 'uj_beteg',
};

// Stages that map to "pre-prosthetic" in the legacy model
const LEGACY_PRE_PROSTHETIC_STAGES = [
  'uj_beteg',
  'onkologiai_kezeles_kesz',
  'arajanlatra_var',
  'implantacios_sebeszi_tervezesre_var',
];

// ── Public types ──────────────────────────────────────────────────────

export interface TimepointAvailability {
  allowed: boolean;
  reason?: string;
  opensAt?: Date;
  closesAt?: Date;
}

// ── Core availability function ────────────────────────────────────────

/**
 * Determine whether a timepoint is currently fillable.
 *
 * T0  – stage-gated: allowed if current stage is before prosthetic phase
 *        (STAGE_0..STAGE_4) or no stage is set yet.
 * T1..T5 – delivery-date-relative: allowed once `now` reaches the timepoint's
 *        open day after delivery (first STAGE_6-or-beyond stage event; T1 opens
 *        immediately) and until the next timepoint opens. Missing an earlier
 *        timepoint never blocks a later one.
 */
export function getTimepointAvailability(
  timepoint: OHIP14Timepoint,
  currentStageCode: string | null,
  deliveryDate: Date | null,
  now: Date = new Date(),
): TimepointAvailability {
  if (timepoint === 'T0') {
    if (!currentStageCode) {
      return { allowed: true, reason: 'Protetikai fázis előtt kitölthető' };
    }
    if (T0_ALLOWED_STAGES.includes(currentStageCode)) {
      return { allowed: true, reason: 'Protetikai fázis előtt kitölthető' };
    }
    return {
      allowed: false,
      reason: `T0 csak a protetikai fázis előtt (STAGE_0–STAGE_4) tölthető ki. Jelenlegi stádium: ${currentStageCode}.`,
    };
  }

  // T1..T5 — delivery-date relative
  if (!deliveryDate) {
    return {
      allowed: false,
      reason: 'Az átadás (STAGE_6 vagy azt követő stádium) még nem történt meg, ezért ez a timepoint nem elérhető.',
    };
  }

  const opensAt = addDays(deliveryDate, OPEN_DAYS[timepoint]);
  const next = NEXT_TIMEPOINT[timepoint];
  const closesAt = next ? addDays(deliveryDate, OPEN_DAYS[next]) : undefined;

  if (now < opensAt) {
    return { allowed: false, reason: `Az időablak még nem nyílt meg.`, opensAt, closesAt };
  }
  if (closesAt && now >= closesAt) {
    return {
      allowed: false,
      reason: `Ez a kérdőív már nem aktuális — egy későbbi timepoint van soron.`,
      opensAt,
      closesAt,
    };
  }
  return { allowed: true, opensAt, closesAt };
}

// ── Backward-compatible wrappers ──────────────────────────────────────

/** @deprecated Use getTimepointAvailability instead */
export function isTimepointAllowedForStage(
  timepoint: OHIP14Timepoint,
  stageCodeOrLegacyStage: string | null,
  useNewModel: boolean,
  deliveryDate: Date | null = null,
): boolean {
  if (useNewModel || !stageCodeOrLegacyStage) {
    return getTimepointAvailability(timepoint, stageCodeOrLegacyStage, deliveryDate).allowed;
  }
  // Legacy model
  if (timepoint === 'T0') {
    return LEGACY_PRE_PROSTHETIC_STAGES.includes(stageCodeOrLegacyStage);
  }
  // T1..T5 in legacy model — only available via delivery date
  return getTimepointAvailability(timepoint, null, deliveryDate).allowed;
}

/**
 * Return the timepoint whose window is currently open (first match).
 * Returns null if none is open. Used by patient portal to auto-select.
 */
export function getTimepointForStage(
  stageCodeOrLegacyStage: string | null,
  useNewModel: boolean,
  deliveryDate: Date | null = null,
): OHIP14Timepoint | null {
  for (const tp of OHIP14_TIMEPOINTS) {
    if (isTimepointAllowedForStage(tp, stageCodeOrLegacyStage, useNewModel, deliveryDate)) {
      return tp;
    }
  }
  return null;
}

// kept for imports that still reference the old mapping
export const OHIP_TIMEPOINT_STAGE_CODES: Record<'T0', string> = {
  T0: 'STAGE_0',
};

// ── Helpers ───────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * For a given delivery date, return all timepoint windows.
 * Used by the reminder system and UI to show upcoming/current windows.
 */
export function getAllTimepointWindows(
  currentStageCode: string | null,
  deliveryDate: Date | null,
): Record<OHIP14Timepoint, TimepointAvailability> {
  return Object.fromEntries(
    OHIP14_TIMEPOINTS.map((tp) => [tp, getTimepointAvailability(tp, currentStageCode, deliveryDate)]),
  ) as Record<OHIP14Timepoint, TimepointAvailability>;
}
