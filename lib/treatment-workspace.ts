import { attended, type AftercareWorkspace } from './aftercare/model';
import type { TimelineEpisode, TimelineStep } from '@/components/TreatmentPlanGantt/types';

export type TreatmentWorkspacePhase = 'assessment' | 'planning' | 'construction' | 'aftercare' | 'mixed';

export function treatmentWorkspacePhase(episode: TimelineEpisode | null, care: AftercareWorkspace | null, episodeId: string): TreatmentWorkspacePhase {
  const prostheses = care?.prostheses.filter((p) => p.episodeId === episodeId) ?? [];
  const delivered = prostheses.filter((p) => p.deliveryDate && p.deliveryConfirmed !== false);
  const constructing = prostheses.some((p) => !p.deliveryDate || p.deliveryConfirmed === false);
  const pendingWork = episode?.steps.some((s) => s.pool === 'work' && s.status !== 'completed') ?? false;
  const aftercareStage = episode?.currentStageCode === 'STAGE_6' || episode?.currentStageCode === 'STAGE_7';
  if ((delivered.length > 0 && (constructing || pendingWork)) || (aftercareStage && pendingWork)) return 'mixed';
  if (aftercareStage || delivered.length > 0) return 'aftercare';
  if (episode?.currentStageCode === 'STAGE_0' || episode?.currentStageCode === 'STAGE_1') return 'assessment';
  if (episode?.currentStageCode === 'STAGE_2' || episode?.currentStageCode === 'STAGE_3') return 'planning';
  return 'construction';
}

export function treatmentWorkspaceHref(patientId: string, episodeId?: string | null, appointmentId?: string | null): string {
  const query = new URLSearchParams();
  if (episodeId) query.set('episodeId', episodeId);
  if (appointmentId) { query.set('appointmentId', appointmentId); query.set('view', 'aftercare'); }
  return `/patients/${patientId}/stages${query.size ? `?${query}` : ''}${appointmentId ? '#gondozas' : ''}`;
}

/** Care appointments join the same visual timeline once each, including shared dentures. */
export function withAftercareTimeline(episode: TimelineEpisode, care: AftercareWorkspace | null): TimelineEpisode {
  if (!care) return episode;
  const prostheses = care.prostheses.filter((p) => p.episodeId === episode.episodeId);
  const ids = new Set(prostheses.map((p) => p.id));
  const existing = new Set(episode.steps.map((s) => s.appointmentId).filter(Boolean));
  const careIds = new Set(care.encounters.filter((v) => v.links.some((l) => ids.has(l.prosthesisId))).map((v) => v.appointmentId));
  const requestIds = new Set(care.requests.filter((r) => r.episodeId === episode.episodeId).map((r) => r.appointmentId).filter(Boolean));
  const deliveries = new Set(prostheses.filter((p) => p.deliveryDate && p.deliveryConfirmed !== false).map((p) => p.deliveryAppointmentId));
  const steps: TimelineStep[] = [];
  for (const a of care.appointments) {
    if (existing.has(a.id) || (!careIds.has(a.id) && !requestIds.has(a.id) && !deliveries.has(a.id))) continue;
    if (a.appointmentStatus !== null && !attended(a.appointmentStatus)) continue;
    steps.push({ stepCode: `care:${a.id}`, stepSeq: episode.steps.length + steps.length,
      label: deliveries.has(a.id) ? 'Fogpótlás átadása' : 'Kontroll / igazítás', pool: 'control', durationMinutes: care.encounters.find((v) => v.appointmentId === a.id)?.clinicalMinutes ?? 0,
      status: attended(a.appointmentStatus) ? 'completed' : 'booked',
      appointmentId: a.id, appointmentStart: a.startTime, appointmentStatus: a.appointmentStatus,
      windowStart: null, windowEnd: null, intentId: null, intentState: null });
  }
  return { ...episode, steps: [...episode.steps, ...steps] };
}
