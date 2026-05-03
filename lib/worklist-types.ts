/**
 * Worklist UI típusok és derived state logika.
 * Single path WIP: WorklistRowState derived, nem backend string tükör.
 */

import { toBudapestStartOfDayISO } from './datetime';

export type WorklistRowState =
  | 'READY'
  | 'BOOKED'
  | 'BLOCKED'
  | 'NEEDS_REVIEW'
  | 'BOOKING_IN_PROGRESS'
  | 'OVERRIDE_REQUIRED'
  | 'COMPLETED'
  | 'SKIPPED';

export type BatchState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ABORTED';

export type ReviewReason = 'MISSING_DURATION' | 'WINDOW_MISSING' | 'POOL_MISSING' | 'STEP_MISSING';

export type SlotQuality = {
  withinWindow: boolean;
  preferredProvider: boolean;
  workloadLevel: 'LOW' | 'MEDIUM' | 'HIGH';
};

export interface OneHardNextViolationPayload {
  code: 'ONE_HARD_NEXT_VIOLATION';
  error: string;
  overrideHint?: string;
  expectedHardNext?: {
    stepCode: string;
    earliestStart: string;
    latestStart: string;
    durationMinutes: number;
  };
  existingAppointment?: {
    id: string;
    startTime: string;
    providerName?: string;
  };
}

export type WorklistPhaseJaw = 'felso' | 'also';

/** Egy munkafázis-sor megjelenítése (összevonás összetételénél vagy önállóan). */
export interface WorklistMergedPhasePart {
  label: string;
  toothNumber?: number | null;
  jaw?: WorklistPhaseJaw | null;
}

/**
 * Egy korábbi próba (attempt) összefoglalója — azokat a megtörtént / meg-nem-
 * jelent próbákat reprezentálja, amelyek NEM az aktuális (legutóbbi) sor.
 * Migration 029 vezette be a `attempt_*` mezőket; a worklist API tölti.
 */
export interface AppointmentAttemptSummary {
  appointmentId: string;
  attemptNumber: number;
  /**
   * `'unsuccessful'` — vizit megvolt, klinikai cél nem teljesült.
   * `'no_show'`      — beteg nem jött el.
   * `'completed'`    — sikeres próba (csak akkor szerepel itt, ha NEM ez az
   *                    aktuális/legutóbbi sor — különben az elsődleges sor).
   */
  status: 'unsuccessful' | 'no_show' | 'completed';
  startTime: string | null;
  endTime: string | null;
  providerEmail: string | null;
  failedReason: string | null;
  failedAt: string | null;
  failedBy: string | null;
}

export interface WorklistItemBackend {
  episodeId: string;
  patientId: string;
  patientName?: string;
  currentStage: string;
  nextStep: string;
  stepLabel?: string;
  stepCode?: string;
  overdueByDays: number;
  windowStart: string | null;
  windowEnd: string | null;
  /** Legkorábbi szabad slot alapú ablak (láncolva); ha nincs, UI a pathway windowStart/windowEnd-et mutatja */
  bookableWindowStart?: string | null;
  bookableWindowEnd?: string | null;
  durationMinutes: number;
  pool: string;
  priorityScore: number;
  noShowRisk: number;
  status?: 'ready' | 'blocked';
  blockedReason?: string;
  /** NO_CARE_PATHWAY: epizódhoz nincs pathway, először válasszon kezelési utat */
  blockedCode?: 'NO_CARE_PATHWAY';
  /** Javasolt kezeléstípus a beteg kezelési tervéből (NO_CARE_PATHWAY esetén) */
  suggestedTreatmentTypeCode?: string | null;
  suggestedTreatmentTypeLabel?: string | null;
  /** Effective treatment type (episode > pathway > patient) — STAGE_5 scheduling */
  treatmentTypeCode?: string | null;
  treatmentTypeLabel?: string | null;
  /** Forrás: episode | pathway | patient | null (debug/support) */
  treatmentTypeSource?: 'episode' | 'pathway' | 'patient' | null;
  /** Forecast ETA (backend returns ISO only, UI formats) */
  forecastCompletionEndP50ISO?: string | null;
  forecastCompletionEndP80ISO?: string | null;
  forecastRemainingP50?: number | null;
  forecastRemainingP80?: number | null;
  /** Existing future appointment for this episode+step (populated by worklist API) */
  bookedAppointmentId?: string | null;
  bookedAppointmentStartTime?: string | null;
  bookedAppointmentProviderEmail?: string | null;
  /**
   * Az aktuális sor "elsődleges" appointmentje (BOOKED esetén = bookedAppointmentId,
   * COMPLETED esetén a legutolsó sikeres appointment). Ezt használja a UI a
   * "Sikertelen próba" akcióhoz, hogy a `PATCH /api/appointments/:id/attempt-outcome`
   * megfelelő ID-t kapjon. Migration 029 utáni mező.
   */
  currentAppointmentId?: string | null;
  currentAppointmentStatus?: 'pending' | 'completed' | 'no_show' | null;
  /**
   * Az aktuális sor próba-sorszáma (1 = első próba, 2 = második, …). Ha
   * nincs hozzárendelt appointment (pl. tisztán pending step), undefined.
   */
  currentAttemptNumber?: number | null;
  /**
   * Korábbi próbák (sikertelen, meg-nem-jelent, vagy "regi" sikeres
   * appointmentek) — `attempt_number` szerint növekvő sorrendben. Ha üres
   * vagy hiányzik, ennek a (episode, step_code) párosnak nem volt korábbi
   * próbája. Migration 029 utáni mező.
   */
  priorAttempts?: AppointmentAttemptSummary[];
  /** 0-based sequence among pending steps for this episode (0 = immediate next) */
  stepSeq?: number;
  /** True for steps beyond the first pending — booking needs requiresPrecommit to bypass one-hard-next */
  requiresPrecommit?: boolean;
  /** 0-based position of the episode in the patient's treatment plan (opened_at order) */
  episodeOrder?: number;
  /**
   * Canonical work-phase row id (episode_work_phases.id) — present when the
   * current pending/scheduled step has a backing row. Drives:
   *   - "mark completed" PATCH /api/episodes/:id/work-phases/:workPhaseId
   *   - the canonical workPhaseId payload field on POST /api/appointments
   *     (since migration 025).
   * Renamed from `episodeStepId` to align with the post-016 canonical
   * vocabulary (work phase, not step).
   */
  workPhaseId?: string | null;
  /** Primary plan item when READ_PLAN_ITEMS and legacy ewp row exists in episode_plan_items */
  planItemId?: string | null;
  /** Epizódhoz kijelölt orvos (user id); csak az ő slotjai jöhetnek szóba foglaláskor */
  assignedProviderId?: string | null;
  /** Episode step status: completed/skipped/pending/scheduled */
  stepStatus?: 'completed' | 'skipped' | 'pending' | 'scheduled';
  /** Több munkafázis egy foglalható blokkba összevonva (primary + gyerek sorok) */
  mergedWorkPhase?: boolean;
  /** Első elem a fő (primary) lépés, utána az összevont gyerekek — fog / állcsont, ha ismert */
  mergedWorkPhaseParts?: WorklistMergedPhasePart[];
  /** Fogszám a fő sorhoz; összevont blokk esetén nincs kitöltve (részletek a mergedWorkPhaseParts-ban) */
  phaseToothNumber?: number | null;
  /** Állcsont a fő sorhoz (episode_pathways.jaw); összevont blokk esetén nincs kitöltve */
  phaseJaw?: WorklistPhaseJaw | null;
}

export interface WorklistLocalState {
  /** rowUiLocked: SlotPicker open */
  rowUiLocked?: Record<string, boolean>;
  /** rowPostInFlight: POST fut */
  rowPostInFlight?: Record<string, boolean>;
  /** 409 után: OVERRIDE_REQUIRED */
  overrideRequiredKeys?: Set<string>;
  /** bookingInProgressKeys */
  bookingInProgressKeys?: Set<string>;
}

/**
 * Kanonikus domain key mindenhol: rowLock, cross-tab, optimistic update.
 * Mindig string.
 */
export function getWorklistItemKey(item: WorklistItemBackend): string {
  if (item.episodeId) {
    const stepCode = item.stepCode ?? item.nextStep;
    if (stepCode && stepCode !== '-') {
      return `${item.episodeId}:${stepCode}`;
    }
    return item.episodeId;
  }
  const windowEndCanonical = item.windowEnd
    ? toBudapestStartOfDayISO(new Date(item.windowEnd))
    : 'unknown';
  const stepCode = item.stepCode ?? item.nextStep ?? 'unknown';
  return `${item.patientId}:${item.episodeId}:${windowEndCanonical}:${stepCode}`;
}

/**
 * Precedence ladder (ütközések elkerülése):
 * 1. BOOKING_IN_PROGRESS – lokális lock
 * 2. OVERRIDE_REQUIRED – lokális, 409 után
 * 3. COMPLETED / SKIPPED – terminális step status (felülír mindent, ami utána jön)
 * 4. BOOKED – létezik bookedAppointmentId
 * 5. BLOCKED – backend.status === 'blocked'  ← előbb, mint a NEEDS_REVIEW,
 *                                              különben a blokkolt epizód
 *                                              hiányos window/duration miatt
 *                                              NEEDS_REVIEW-nak látszhat.
 * 6. NEEDS_REVIEW – hiányzó duration/window/pool/step
 * 7. READY – minden invariáns rendben
 */
export function deriveWorklistRowState(
  item: WorklistItemBackend,
  local: WorklistLocalState,
  key: string
): { state: WorklistRowState; reviewReason?: ReviewReason } {
  const isBookingInProgress = local.bookingInProgressKeys?.has(key) ?? local.rowPostInFlight?.[key];
  const isOverrideRequired = local.overrideRequiredKeys?.has(key);
  const isUiLocked = local.rowUiLocked?.[key];

  if (isBookingInProgress || isUiLocked) {
    return { state: 'BOOKING_IN_PROGRESS' };
  }
  if (isOverrideRequired) {
    return { state: 'OVERRIDE_REQUIRED' };
  }

  if (item.stepStatus === 'completed') {
    return { state: 'COMPLETED' };
  }
  if (item.stepStatus === 'skipped') {
    return { state: 'SKIPPED' };
  }

  if (item.bookedAppointmentId) {
    return { state: 'BOOKED' };
  }

  // BLOCKED before NEEDS_REVIEW: a blokkolt epizód miatt a backend
  // szándékosan nem tölt durations/windows-t (gyakran null), így a NEEDS_REVIEW
  // előbb futtatva eltakarná a valódi BLOCKED okot.
  if (item.status === 'blocked') {
    return { state: 'BLOCKED' };
  }

  if (!item.durationMinutes || item.durationMinutes <= 0) {
    return { state: 'NEEDS_REVIEW', reviewReason: 'MISSING_DURATION' };
  }
  if (!item.windowStart || !item.windowEnd) {
    return { state: 'NEEDS_REVIEW', reviewReason: 'WINDOW_MISSING' };
  }
  if (!item.pool || !['consult', 'work', 'control'].includes(item.pool)) {
    return { state: 'NEEDS_REVIEW', reviewReason: 'POOL_MISSING' };
  }
  if (!item.nextStep || item.nextStep === '-') {
    return { state: 'NEEDS_REVIEW', reviewReason: 'STEP_MISSING' };
  }

  return { state: 'READY' };
}
