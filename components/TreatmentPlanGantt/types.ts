/** Három egységes lépés-státusz a kezelési terv idővonalon. */
export type TimelineStepStatus = 'completed' | 'booked' | 'planned';

export interface TimelineStep {
  stepCode: string;
  stepSeq: number;
  label: string;
  pool: string;
  durationMinutes: number;
  status: TimelineStepStatus;
  windowStart: string | null;
  windowEnd: string | null;
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string | null;
  intentId: string | null;
  intentState: string | null;
  planItemId?: string | null;
}

export interface TimelineEpisode {
  episodeId: string;
  patientId: string;
  patientName: string;
  reason: string;
  status: string;
  openedAt: string;
  carePathwayName: string | null;
  assignedProviderId?: string | null;
  assignedProviderName: string | null;
  treatmentTypeLabel: string | null;
  steps: TimelineStep[];
  etaHeuristic: string | null;
}

export interface TimelineMetaCounts {
  totalEpisodes: number;
  actionNeededIn7d: number;
}

export interface TimelineMeta {
  serverNow: string;
  fetchedAt: string;
  timezone: string;
  ordering: string;
  readPlanItemsEnabled?: boolean;
  counts?: TimelineMetaCounts;
}

export type ZoomPreset = '14d' | '30d' | '90d' | 'auto';

export type EpisodeStatusFilter = 'open' | 'closed' | 'all';

export interface ProviderOption {
  id: string;
  name: string;
}
