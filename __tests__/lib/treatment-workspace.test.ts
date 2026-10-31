import { describe, expect, it } from 'vitest';
import { treatmentWorkspaceHref, treatmentWorkspacePhase, withAftercareTimeline } from '@/lib/treatment-workspace';
import { careWorkspace, prosthesis, timelineEpisode, timelineStep } from '../fixtures/treatment-workspace';

describe('Stage-aware treatment workspace', () => {
  it.each([['STAGE_0', 'assessment'], ['STAGE_2', 'planning'], ['STAGE_5', 'construction'], ['STAGE_6', 'aftercare'], ['STAGE_7', 'aftercare']])('uses %s as the default context', (stage, expected) => {
    expect(treatmentWorkspacePhase(timelineEpisode({ currentStageCode: stage }), null, 'upper')).toBe(expected);
  });
  it('uses confirmed delivery before the overall stage is updated', () => {
    expect(treatmentWorkspacePhase(timelineEpisode(), careWorkspace({ prostheses: [prosthesis()] }), 'upper')).toBe('aftercare');
    expect(treatmentWorkspacePhase(timelineEpisode(), careWorkspace({ prostheses: [prosthesis({ deliveryConfirmed: false })] }), 'upper')).toBe('construction');
  });
  it('keeps construction visible for mixed cases and ignores other episodes', () => {
    const care = careWorkspace({ prostheses: [prosthesis(), prosthesis({ id: 'p2', jaw: 'also', deliveryDate: null })] });
    expect(treatmentWorkspacePhase(timelineEpisode(), care, 'upper')).toBe('mixed');
    expect(treatmentWorkspacePhase(timelineEpisode(), care, 'lower')).toBe('construction');
    expect(treatmentWorkspacePhase(timelineEpisode({ currentStageCode: 'STAGE_7', steps: [timelineStep({ status: 'planned' })] }), null, 'upper')).toBe('mixed');
  });
  it('counts a shared delivery or care appointment once on the timeline and keeps later care', () => {
    const episode = timelineEpisode({ steps: [timelineStep({ appointmentId: 'delivery' })] });
    const care = careWorkspace({ prostheses: [prosthesis(), prosthesis({ id: 'p2', jaw: 'also' })], appointments: [
      { id: 'delivery', episodeId: 'upper', startTime: '2026-01-31T10:00:00Z', occurredOn: '2026-01-31', appointmentStatus: 'completed', clinician: 'Doctor' },
      { id: 'late-care', episodeId: 'upper', startTime: '2026-10-01T10:00:00Z', occurredOn: '2026-10-01', appointmentStatus: 'unsuccessful', clinician: 'Doctor' },
    ], encounters: [{ id: 'c1', appointmentId: 'late-care', phase: 'aftercare',
      version: 1, occurredOn: '2026-10-01', clinician: 'Doctor', appointmentStatus: 'unsuccessful', clinicalMinutes: null,
      constructionActivities: [], planDeviation: '', delayReason: 'none', note: '', returnAfterDays: null,
      links: ['p1', 'p2'].map((prosthesisId) => ({ prosthesisId, problems: [], interventions: [], result: null, nextAction: null, functionScore: null, comfortScore: null })) }] });
    const result = withAftercareTimeline(episode, care);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]).toMatchObject({ appointmentId: 'late-care', status: 'completed', pool: 'control' });
    expect(episode.steps).toHaveLength(1);
    care.appointments[1].appointmentStatus = 'no_show';
    expect(withAftercareTimeline(episode, care).steps).toHaveLength(1);
  });
  it('builds episode-specific links and preserves the exact care appointment', () => {
    expect(treatmentWorkspaceHref('p', 'upper', 'visit')).toBe('/patients/p/stages?episodeId=upper&appointmentId=visit&view=aftercare#gondozas');
  });
});
