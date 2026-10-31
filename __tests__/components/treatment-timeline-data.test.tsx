import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useTimelineData } from '@/components/TreatmentPlanGantt/useTimelineData';
import { careWorkspace, prosthesis, timelineEpisode } from '../fixtures/treatment-workspace';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const episode = timelineEpisode();
const care = careWorkspace({ prostheses: [prosthesis()], appointments: [{
  id: 'delivery', episodeId: 'upper', startTime: '2026-01-31T10:00:00Z', occurredOn: '2026-01-31', appointmentStatus: 'completed', clinician: 'Doctor',
}] });
const options = { status: 'all' as const, providerId: '', searchDebounced: '', patientId: 'patient', episodeId: 'upper' };

describe('Shared GANTT and workspace data', () => {
  it('includes care events in the full patient GANTT and requests the exact episode without excluding Gondozás', async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/aftercare') ? care : { episodes: [episode] } }));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useTimelineData(options));
    await waitFor(() => expect(result.current.episodes[0]?.steps[0]?.appointmentId).toBe('delivery'));
    const query = new URL(fetcher.mock.calls.find(([url]) => url.startsWith('/api/treatment-plan-timeline'))![0], 'http://localhost').searchParams;
    expect(query.get('patientId')).toBe('patient'); expect(query.get('episodeId')).toBe('upper'); expect(query.has('activeOnly')).toBe(false);
  });
  it('reuses the loaded care workspace without a second request', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ episodes: [episode] }) }));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useTimelineData({ ...options, careWorkspace: care }));
    await waitFor(() => expect(result.current.episodes[0]?.steps[0]?.appointmentId).toBe('delivery'));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('marks the chart incomplete when care data fail while retaining the known treatment history', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: !url.includes('/aftercare'), json: async () => ({ episodes: [episode] }) })));
    const { result } = renderHook(() => useTimelineData(options));
    await waitFor(() => expect(result.current.careError).toContain('hiányos'));
    expect(result.current.episodes).toHaveLength(1);
  });
});
