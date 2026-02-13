/**
 * Worklist UI típusok és derived state logika.
 * Single path WIP: WorklistRowState derived, nem backend string tükör.
 */

import { toBudapestStartOfDayISO } from './datetime';

// Táblában: BOOKED state NINCS – single success → remove (sor eltűnik)
// Batch queue item státusz: BOOKED (queue-on belül)
export type WorklistRowState =
  | 'READY'
  | 'BLOCKED'
  | 'NEEDS_REVIEW'
  | 'BOOKING_IN_PROGRESS'
  | 'OVERRIDE_REQUIRED';

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

export interface WorklistItemBackend {
  episodeId: string;
  patientId: string;
  patientName?: string;
  currentStage: string;
  nextStep: string;
  stepCode?: string;
  overdueByDays: number;
  windowStart: string | null;
  windowEnd: string | null;
  durationMinutes: number;
  pool: string;
  priorityScore: number;
  noShowRisk: number;
  status?: 'ready' | 'blocked';
  blockedReason?: string;
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
 * 3. NEEDS_REVIEW – validációs hiba
 * 4. BLOCKED – backend.status === 'blocked'
 * 5. READY – backend.status === 'ready' && !localBookingLock
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

  // NEEDS_REVIEW – validation
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

  if (item.status === 'blocked') {
    return { state: 'BLOCKED' };
  }

  return { state: 'READY' };
}
