import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), release: vi.fn(), phases: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/api/route-handler', () => ({ roleHandler: (_roles: unknown, handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query, connect: async () => ({ query: mocks.clientQuery, release: mocks.release }) }) }));
vi.mock('@/lib/step-labels', () => ({ getStepLabelMap: async () => new Map() }));
vi.mock('@/lib/plan-items-flags', () => ({ isReadPlanItemsEnabled: () => false }));
import { GET } from '@/app/api/treatment-plan-timeline/route';

const patientId = '11111111-1111-4111-8111-111111111111';
const episodeId = '22222222-2222-4222-8222-222222222222';
const context = { auth: { userId: 'staff', email: 'staff@example.test', role: 'admin' }, params: {}, correlationId: 'test' } as const;
const request = (query: string) => new NextRequest(`http://localhost/api/treatment-plan-timeline?${query}`);

beforeEach(() => {
  vi.clearAllMocks(); mocks.phases = [];
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM patient_episodes pe') ? [{
    episode_id: episodeId, patient_id: patientId, patient_name: 'Tesztbeteg', reason: 'traumás sérülés', status: 'open',
    opened_at: '2026-01-01T09:00:00Z', plan_start_date: null, closed_at: null,
    work_phases_json: [], steps_json: [], care_pathway_name: null,
  }] : sql.includes('FROM stage_catalog') ? [{ code: 'STAGE_7', reason: 'traumás sérülés', label_hu: 'Gondozás alatt', order_index: 7 }] : [] }));
  mocks.clientQuery.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM stage_events')
    ? [{ episode_id: episodeId, stage_code: 'STAGE_7', at: '2026-02-01T09:00:00Z' }]
    : sql.includes('FROM episode_work_phases ewp') ? mocks.phases : [] }));
});

describe('Patient-scoped shared treatment timeline', () => {
  it('keeps a care episode without a template or future construction steps', async () => {
    const response = await GET(request(`patientId=${patientId}&episodeId=${episodeId}&status=all`), context);
    const data = await response.json();
    expect(data.episodes).toHaveLength(1);
    expect(data.episodes[0]).toMatchObject({ episodeId, currentStageCode: 'STAGE_7', currentStageLabel: 'Gondozás alatt', steps: [] });
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('pe.patient_id = $1 AND pe.id = $2');
    expect(sql).not.toContain('pe.care_pathway_id IS NOT NULL');
    expect(params.slice(0, 2)).toEqual([patientId, episodeId]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('preserves manual completion and does not recreate skipped phases from the template', async () => {
    mocks.phases = [
      { episode_id: episodeId, episode_work_phase_id: 'done', step_code: 'lenyomat', step_seq: 0, pool: 'work', duration_minutes: 30, status: 'completed', completed_at: '2026-01-15T10:00:00Z' },
      { episode_id: episodeId, episode_work_phase_id: 'skip', step_code: 'probak', step_seq: 1, pool: 'work', duration_minutes: 30, status: 'skipped' },
    ];
    const response = await GET(request(`patientId=${patientId}&episodeId=${episodeId}&status=all`), context);
    const data = await response.json();
    expect(data.episodes[0].steps).toHaveLength(1);
    expect(data.episodes[0].steps[0]).toMatchObject({ status: 'completed', appointmentStart: '2026-01-15T10:00:00.000Z' });
  });
  it.each([`patientId=invalid`, `episodeId=${episodeId}`, `patientId=${patientId}&episodeId=invalid`])('rejects invalid or unscoped identifiers: %s', async (query) => {
    const response = await GET(request(query), context);
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
