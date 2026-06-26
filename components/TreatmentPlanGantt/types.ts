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

export interface StageInterval {
  stageCode: string;
  /** stage_catalog label_hu (code+reason szerint). */
  label?: string;
  start: string;
  end: string;
}

export interface StageLegendEntry {
  code: string;
  label: string;
}

/** Az egyesített idővonal nézetmódjai: stádium-sáv, kezelési lépések, vagy mindkettő. */
export type TimelineViewMode = 'stage' | 'steps' | 'merged';

export interface TimelineEpisode {
  episodeId: string;
  patientId: string;
  patientName: string;
  reason: string;
  status: string;
  openedAt: string;
  /** COALESCE(plan_start_date, opened_at) — a kezelés tényleges kezdete. */
  started?: string;
  closedAt?: string | null;
  carePathwayName: string | null;
  assignedProviderId?: string | null;
  assignedProviderName: string | null;
  treatmentTypeLabel: string | null;
  /** A legutóbbi stádium kódja (STAGE_0..STAGE_7); STAGE_7 = gondozás alatt. */
  currentStageCode?: string | null;
  /** A legutóbbi stádium neve a stage_catalog-ból. */
  currentStageLabel?: string | null;
  /** Stádium-intervallumok a háttérsávhoz. */
  stageIntervals?: StageInterval[];
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
  stageLegend?: StageLegendEntry[];
  counts?: TimelineMetaCounts;
}

export type ZoomPreset = '14d' | '30d' | '90d' | 'auto';

export type EpisodeStatusFilter = 'open' | 'closed' | 'all';

export interface ProviderOption {
  id: string;
  name: string;
}
