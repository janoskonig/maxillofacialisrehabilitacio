/**
 * Virtual appointments = next required steps not yet booked.
 * Domain contract: types and semantics for virtual appointment visualization.
 */

export type VirtualStatus = 'READY' | 'BLOCKED' | 'BOOKED' | 'INVALID';

export type VirtualPool = 'work' | 'consult' | 'control';

export interface VirtualAppointment {
  virtualKey: string;
  episodeId: string;
  patientId: string;
  patientName: string;
  stepCode: string;
  stepLabel: string;
  pool: VirtualPool;
  durationMinutes: number;

  windowStartDate: string; // YYYY-MM-DD
  windowEndDate: string;   // YYYY-MM-DD (inclusive)

  assignedProviderId?: string | null;
  assignedProviderName?: string | null;

  virtualStatus: VirtualStatus;
  derivedFrom: 'wip_next_step';
  computedAtISO: string;
  serverNowISO: string;

  /** Deep link: UI never builds links ad hoc. Use this or worklistParams. */
  worklistUrl: string;
  /** Canonical params for worklist navigation (episodeId, stepCode, pool). */
  worklistParams: { episodeId: string; stepCode: string; pool: string };
}

export interface VirtualAppointmentsResponse {
  queryEcho: {
    startDate: string;
    endDate: string;
    horizonDays: number;
    providerId?: string;
    pool?: string;
    readyOnly?: boolean;
  };
  serverNowISO: string;
  computedAtISO: string;
  rangeStartDate: string;
  rangeEndDate: string;
  dateDomain: 'DATE_ONLY_INCLUSIVE';
  timezone: 'Europe/Budapest';
  items: VirtualAppointment[];
  meta: {
    itemsBeforeFilter: number;
    itemsAfterFilter: number;
    computeMs: number;
    dbMs: number;
    limitApplied?: number;
  };
}
