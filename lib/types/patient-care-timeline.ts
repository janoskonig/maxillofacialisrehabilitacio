/** Unified patient care timeline event types (stádiumkezelő). */

export type CareTimelineEventType =
  | 'stage_change'
  | 'consilium'
  | 'consilium_prep'
  | 'delegated_task'
  | 'consilium_prep_link'
  | 'milestone'
  | 'work_phase';

export type CareTimelineFilterCategory = 'all' | 'stage' | 'consilium' | 'tasks';

export type CareTimelineStageChangePayload = {
  stageCode: string;
  stageLabel: string;
  note: string | null;
  authorDisplay: string | null;
};

export type CareTimelineConsiliumPayload = {
  sessionId: string;
  itemId: string;
  title: string;
  sessionStatus: string;
  scheduledAt: string;
  discussed: boolean;
  verdictSummary: string | null;
};

export type CareTimelineConsiliumPrepPayload = {
  sessionId: string;
  itemId: string;
  checklistKey: string;
  body: string;
  authorDisplay: string | null;
};

export type CareTimelineDelegatedTaskPayload = {
  taskId: string;
  title: string;
  status: string;
  source: string | null;
  assigneeName: string | null;
  presentationPath: string | null;
  consiliumSessionId: string | null;
};

export type CareTimelinePrepLinkPayload = {
  messageId: string;
  token: string;
  prepUrl: string;
  senderName: string | null;
};

export type CareTimelineMilestonePayload = {
  code: string;
  label: string;
  note: string | null;
};

export type CareTimelineWorkPhasePayload = {
  workPhaseId: string;
  workPhaseCode: string;
  label: string;
  status: 'completed' | 'skipped';
};

export type CareTimelineEventBase = {
  id: string;
  type: CareTimelineEventType;
  at: string;
  episodeId: string | null;
};

export type CareTimelineEvent =
  | (CareTimelineEventBase & { type: 'stage_change'; payload: CareTimelineStageChangePayload })
  | (CareTimelineEventBase & { type: 'consilium'; payload: CareTimelineConsiliumPayload })
  | (CareTimelineEventBase & { type: 'consilium_prep'; payload: CareTimelineConsiliumPrepPayload })
  | (CareTimelineEventBase & { type: 'delegated_task'; payload: CareTimelineDelegatedTaskPayload })
  | (CareTimelineEventBase & { type: 'consilium_prep_link'; payload: CareTimelinePrepLinkPayload })
  | (CareTimelineEventBase & { type: 'milestone'; payload: CareTimelineMilestonePayload })
  | (CareTimelineEventBase & { type: 'work_phase'; payload: CareTimelineWorkPhasePayload });

export type CareTimelineEpisodeSummary = {
  episodeId: string;
  reason: string | null;
  status: string | null;
  chiefComplaint: string | null;
  caseTitle: string | null;
  openedAt: string | null;
  closedAt: string | null;
  events: CareTimelineEvent[];
};

export type PatientCareTimelineResponse = {
  patientId: string;
  episodes: CareTimelineEpisodeSummary[];
  /** Legutóbbi stádiumváltás (bármely epizódból), ha van. */
  currentStage: {
    episodeId: string;
    stageCode: string;
    stageLabel: string;
    at: string;
    note: string | null;
  } | null;
};
