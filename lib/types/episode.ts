import { z } from 'zod';

export const REASON_VALUES = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'] as const;
export type ReasonType = typeof REASON_VALUES[number];

export const EPISODE_STATUS_VALUES = ['open', 'closed', 'paused'] as const;
export type EpisodeStatus = typeof EPISODE_STATUS_VALUES[number];

export const TRIGGER_TYPE_VALUES = ['recidiva', 'fogelvesztes', 'potlasvesztes', 'kontrollbol_uj_panasz', 'egyeb'] as const;
export type TriggerType = typeof TRIGGER_TYPE_VALUES[number];

export interface PatientEpisode {
  id: string;
  patientId: string;
  reason: ReasonType;
  pathwayCode?: string | null;
  chiefComplaint: string;
  caseTitle?: string | null;
  status: EpisodeStatus;
  openedAt: string;
  closedAt?: string | null;
  parentEpisodeId?: string | null;
  triggerType?: TriggerType | null;
  createdAt?: string | null;
  createdBy?: string | null;
  carePathwayId?: string | null;
  assignedProviderId?: string | null;
  carePathwayName?: string | null;
  assignedProviderName?: string | null;
  treatmentTypeId?: string | null;
  treatmentTypeCode?: string | null;
  treatmentTypeLabel?: string | null;
  stageVersion?: number;
  snapshotVersion?: number;
  episodePathways?: Array<{
    id: string;
    carePathwayId: string;
    ordinal: number;
    pathwayName: string;
    stepCount: number;
  }>;
}

export const RULESET_STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'DEPRECATED'] as const;
export type RulesetStatus = typeof RULESET_STATUS_VALUES[number];

export interface StageTransitionRule {
  id: string;
  from_stage: string;
  to_stage: string;
  description: string;
  conditions: string[];
}

export interface StageTransitionRuleset {
  id: string;
  version: number;
  status: RulesetStatus;
  rules: StageTransitionRule[];
  validFrom?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
  publishedAt?: string | null;
}

export interface StageSuggestion {
  id: string;
  episodeId: string;
  suggestedStage: string;
  fromStage?: string | null;
  rulesetVersion: number;
  snapshotVersion: number;
  dedupeKey: string;
  ruleIds: string[];
  computedAt: string;
}

export const INTAKE_STATUS_VALUES = ['JUST_REGISTERED', 'NEEDS_TRIAGE', 'TRIAGED', 'IN_CARE'] as const;
export type IntakeStatus = typeof INTAKE_STATUS_VALUES[number];

export const INTAKE_ITEM_STATUS_VALUES = ['OPEN', 'RESOLVED', 'CANCELLED'] as const;
export type IntakeItemStatus = typeof INTAKE_ITEM_STATUS_VALUES[number];

export interface PatientIntakeItem {
  id: string;
  patientId: string;
  kind: string;
  status: IntakeItemStatus;
  source?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  createdBy?: string | null;
  notes?: string | null;
}

export const EPISODE_STEP_STATUS_VALUES = ['pending', 'scheduled', 'completed', 'skipped'] as const;
export type EpisodeStepStatus = typeof EPISODE_STEP_STATUS_VALUES[number];

export interface EpisodeStep {
  id: string;
  episodeId: string;
  stepCode: string;
  pathwayOrderIndex: number;
  pool: string;
  durationMinutes: number;
  defaultDaysOffset: number;
  status: EpisodeStepStatus;
  appointmentId?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  label?: string;
}

export interface EpisodeGetResponse extends PatientEpisode {
  currentRulesetVersion?: number;
  stageSuggestion?: StageSuggestion | null;
  currentStageCode?: string | null;
  currentStageLabel?: string | null;
}

export interface StageCatalogEntry {
  code: string;
  reason: ReasonType;
  labelHu: string;
  orderIndex: number;
  isTerminal: boolean;
  defaultDurationDays?: number | null;
}

export interface StageEventEntry {
  id: string;
  patientId: string;
  episodeId: string;
  stageCode: string;
  at: string;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
}

export interface PatientMilestoneEntry {
  id: string;
  patientId: string;
  episodeId: string;
  code: string;
  at: string;
  params?: Record<string, unknown> | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
}

export type PatientStage =
  | 'uj_beteg'
  | 'onkologiai_kezeles_kesz'
  | 'arajanlatra_var'
  | 'implantacios_sebeszi_tervezesre_var'
  | 'fogpotlasra_var'
  | 'fogpotlas_keszul'
  | 'fogpotlas_kesz'
  | 'gondozas_alatt';

export const patientStageSchema = z.object({
  id: z.string().optional(),
  patientId: z.string().min(1, 'Beteg ID kötelező'),
  episodeId: z.string().min(1, 'Epizód ID kötelező'),
  stage: z.enum([
    'uj_beteg', 'onkologiai_kezeles_kesz', 'arajanlatra_var',
    'implantacios_sebeszi_tervezesre_var', 'fogpotlasra_var',
    'fogpotlas_keszul', 'fogpotlas_kesz', 'gondozas_alatt'
  ]),
  stageDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
});

export type PatientStageEntry = z.infer<typeof patientStageSchema>;

export interface PatientStageTimeline {
  currentStage: PatientStageEntry | null;
  history: PatientStageEntry[];
  episodes: {
    episodeId: string;
    startDate: string;
    endDate?: string;
    stages: PatientStageEntry[];
  }[];
}

export const patientStageOptions: Array<{ value: PatientStage; label: string }> = [
  { value: 'uj_beteg', label: 'Új beteg' },
  { value: 'onkologiai_kezeles_kesz', label: 'Onkológiai kezelés kész' },
  { value: 'arajanlatra_var', label: 'Árajánlatra vár' },
  { value: 'implantacios_sebeszi_tervezesre_var', label: 'Implantációs sebészi tervezésre vár' },
  { value: 'fogpotlasra_var', label: 'Fogpótlásra vár' },
  { value: 'fogpotlas_keszul', label: 'Fogpótlás készül' },
  { value: 'fogpotlas_kesz', label: 'Fogpótlás kész' },
  { value: 'gondozas_alatt', label: 'Gondozás alatt' },
];

export interface StageEventTimeline {
  currentStage: StageEventEntry | null;
  history: StageEventEntry[];
  episodes: {
    episodeId: string;
    episode?: PatientEpisode;
    startDate: string;
    endDate?: string;
    stages: StageEventEntry[];
  }[];
}

export const TOOTH_TREATMENT_STATUS_VALUES = ['pending', 'episode_linked', 'completed'] as const;
export type ToothTreatmentStatus = typeof TOOTH_TREATMENT_STATUS_VALUES[number];

export interface ToothTreatmentCatalogItem {
  code: string;
  labelHu: string;
  labelEn: string | null;
  defaultCarePathwayId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ToothTreatment {
  id: string;
  patientId: string;
  toothNumber: number;
  treatmentCode: string;
  status: ToothTreatmentStatus;
  episodeId: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  labelHu?: string;
}
