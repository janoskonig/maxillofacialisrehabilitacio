/**
 * Kanonikus konstansok a scheduling UI-hoz.
 * Egyetlen forrás: dokumentum és kód 1:1.
 */

// Error codes (backend code mező = UI taxonomy key)
export const BOOKING_ERROR_CODES = {
  ONE_HARD_NEXT_VIOLATION: 'ONE_HARD_NEXT_VIOLATION',
  SLOT_ALREADY_BOOKED: 'SLOT_ALREADY_BOOKED',
  UNKNOWN_SERVER_ERROR: 'UNKNOWN_SERVER_ERROR',
  WINDOW_INVALID: 'WINDOW_INVALID',
  DURATION_INVALID: 'DURATION_INVALID',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
} as const;

// SWR/React Query cache keys (egy forrás – dokumentum és kód 1:1)
export const CACHE_KEYS = {
  worklist: 'worklist:wip-next',
  slots: (k: string) => 'slots:for-booking:' + k,
  patientAppointments: (patientId: string) => `patient:${patientId}:appointments`,
  episodeForecast: (episodeId: string) => `episode:${episodeId}:forecast`,
  episodeBlocks: (episodeId: string) => `episode:${episodeId}:blocks`,
} as const;

/**
 * Slots cache key: típusbiztos, fix sorrend.
 * windowStartISO = Budapest start-of-day (inclusive)
 * windowEndISO = Budapest start-of-day (exclusive)
 * Ha valaki később „okosít" és windowEndISO-t 23:59-re állítja, ugyanaz az ablak más cache key-t kapna.
 */
export function buildSlotsCacheKey(p: {
  pool: 'work' | 'consult' | 'control';
  duration: number;
  windowStartISO: string;
  windowEndISO: string;
  provider?: string;
}): string {
  const provider = p.provider ?? 'all';
  return `${p.pool}|${p.duration}|${p.windowStartISO}|${p.windowEndISO}|${provider}`;
}

// UI feature flags
export const UI_FEATURE_FLAGS = {
  twoPhaseBookingConfirm: 'ff_twoPhaseBookingConfirm',
  realtimeWorklist: 'ff_realtimeWorklist',
  showDegradedPathwayIcon: 'ff_showDegradedPathwayIcon',
} as const;

// Kétirányú mapping – label-ek (operator-grade: line1 max 50 char, line2 max 60 char)
export type BookingErrorLabel = { title: string; action?: string };
export const BOOKING_ERROR_LABELS: Record<string, BookingErrorLabel> = {
  ONE_HARD_NEXT_VIOLATION: {
    title: 'Epizódnak már van jövőbeli munkafoglalása',
    action: 'Override vagy más epizód.',
  },
  SLOT_ALREADY_BOOKED: {
    title: 'A slot már foglalt.',
    action: 'Válassz másikat (lista frissült).',
  },
  UNKNOWN_SERVER_ERROR: {
    title: 'Ismeretlen szerver hiba.',
    action: 'Copy details és próbáld újra.',
  },
  WINDOW_INVALID: {
    title: 'Érvénytelen ablak.',
    action: 'Ellenőrizd a window mezőket.',
  },
  DURATION_INVALID: {
    title: 'Érvénytelen időtartam.',
    action: 'Állítsd be a duration-t.',
  },
  NOT_AUTHORIZED: {
    title: 'Nincs jogosultság.',
    action: 'Jelentkezz be újra.',
  },
  NETWORK_TIMEOUT: {
    title: 'Hálózati időtúllépés.',
    action: 'Próbáld újra.',
  },
};

export const SCHED_EVENT_LABELS: Record<string, string> = {
  appointment_created: 'Foglalás létrehozva',
  appointment_cancelled: 'Foglalás lemondva',
  block_added: 'Blokk hozzáadva',
  block_renewed: 'Blokk megújítva',
  block_removed: 'Blokk eltávolítva',
};
