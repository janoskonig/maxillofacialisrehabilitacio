import type { AftercareWorkspace, Prosthesis } from '@/lib/aftercare/model';
import type { TimelineEpisode, TimelineStep } from '@/components/TreatmentPlanGantt/types';

export const timelineStep = (overrides: Partial<TimelineStep> = {}): TimelineStep => ({
  stepCode: 'lenyomat', stepSeq: 0, label: 'Lenyomatvétel', pool: 'work', durationMinutes: 30,
  status: 'completed', windowStart: null, windowEnd: null, appointmentId: null,
  appointmentStart: null, appointmentStatus: null, intentId: null, intentState: null, ...overrides,
});
export const timelineEpisode = (overrides: Partial<TimelineEpisode> = {}): TimelineEpisode => ({
  episodeId: 'upper', patientId: 'patient', patientName: 'Tesztbeteg', reason: 'traumás sérülés', status: 'open',
  openedAt: '2026-01-01T09:00:00Z', carePathwayName: null, assignedProviderName: null,
  treatmentTypeLabel: null, steps: [], etaHeuristic: null, currentStageCode: 'STAGE_5', ...overrides,
});
export const prosthesis = (overrides: Partial<Prosthesis> = {}): Prosthesis => ({
  id: 'p1', patientId: 'patient', episodeId: 'upper', jaw: 'felso', prosthesisType: 'obturator', label: 'Felső obturátor',
  deliveryDate: '2026-01-31', deliveryAppointmentId: 'delivery', deliveryConfirmed: true,
  baseline: {}, originalPlan: {}, createdAt: '2026-01-01', ...overrides,
});
export const careWorkspace = (overrides: Partial<AftercareWorkspace> = {}): AftercareWorkspace => ({
  patientName: 'Tesztbeteg', deceased: false, episodes: [{ id: 'upper', label: 'Felső fogpótlás', status: 'open' }],
  prostheses: [], appointments: [], encounters: [], requests: [], ...overrides,
});
