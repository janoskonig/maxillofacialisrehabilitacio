// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m = vi.hoisted(() => ({ query: vi.fn(), schema: vi.fn(), load:vi.fn(), execute:vi.fn(), auth: { userId: 'u1', email: 'test@example.com', role: 'admin' } }));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: m.query }) }));
vi.mock('@/lib/prosthesis-lifecycle/service',()=>({executeClinicalCommand:m.execute}));
vi.mock('@/lib/prosthesis-lifecycle/plans',async original=>({...await original<typeof import('@/lib/prosthesis-lifecycle/plans')>(),loadEpisodeTreatmentPlan:m.load}));
vi.mock('@/lib/schema-probe', () => ({ probeColumnExists: m.schema }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => true) }));
vi.mock('@/lib/legal/patient-data-access-log', () => ({ maybeLogPatientAccess: vi.fn() }));
vi.mock('@/lib/auth-server', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth-server')>();
  return { ...original, requireAuth: vi.fn(async () => m.auth), requireRole: vi.fn(async (_req, allowed: string[]) => {
    if (!allowed.includes(m.auth.role)) throw new original.HttpError(403, 'Nincs jogosultság');
    return m.auth;
  }) };
});
import { GET, PATCH } from '@/app/api/episodes/[id]/treatment-plan/route';
import { TreatmentPlanConflict } from '@/lib/prosthesis-lifecycle/plans';
import { MAX_EPISODE_TREATMENT_PLAN_LENGTH } from '@/lib/episode-treatment-plan';
const id = '11111111-2222-4333-8444-555555555555';
const record = { episodeId: id,patientId:id,treatmentPlan: 'Mentett terv',treatmentPlanUpper:null,treatmentPlanLower:null,version: 1 };
const request = (body?: unknown) => new NextRequest(`http://test.local/api/episodes/${id}/treatment-plan`, body === undefined ? {} : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.schema.mockResolvedValue(true); m.auth.role = 'admin'; m.query.mockResolvedValue({ rows: [record] });m.load.mockResolvedValue(record);m.execute.mockResolvedValue({id,eventId:id}); });
describe('Episode treatment plan API', () => {
  it('returns the saved plan with its version and no-store cache policy', async () => {
    const res = await GET(request(), { params: { id } });
    expect((await res.json()).plan).toEqual(record);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
  it('saves only the narrative with the expected version, preserving line breaks', async () => {
    const res = await PATCH(request({ treatmentPlan: '  Új terv\nMásodik sor  ', expectedVersion: 1 }), { params: { id } });
    expect(res.status).toBe(200);
    expect(m.execute).toHaveBeenCalledWith(id,'u1',expect.objectContaining({action:'plan',expectedVersion:1,approved:false,narratives:{treatmentPlan:'Új terv\nMásodik sor'}}));
  });
  it('clears an empty narrative explicitly', async () => {
    await PATCH(request({ treatmentPlan: '   ', expectedVersion: 1 }), { params: { id } });
    expect(m.execute.mock.calls[0][2].narratives).toEqual({treatmentPlan:null});
  });
  it('rejects stale edits and returns the new server version for comparison', async () => {
    m.execute.mockRejectedValueOnce(new TreatmentPlanConflict(record));
    const res = await PATCH(request({ treatmentPlan: 'Régi változat', expectedVersion: 0 }), { params: { id } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'TREATMENT_PLAN_CONFLICT', plan: record });
  });
  it('reports a missing episode instead of a conflict', async () => {
    m.load.mockResolvedValue(null);
    expect((await PATCH(request({ treatmentPlan: 'Terv', expectedVersion: 0 }), { params: { id } })).status).toBe(404);
  });
  it.each([
    { treatmentPlan: 42, expectedVersion: 0 },
    { treatmentPlan: 'Terv' },
    { treatmentPlan: 'Terv', expectedVersion: -1 },
    { treatmentPlan: 'Terv', expectedVersion: 0.5 },
    { treatmentPlan: 'x'.repeat(MAX_EPISODE_TREATMENT_PLAN_LENGTH + 1), expectedVersion: 0 },
  ])('rejects invalid data before a DB write', async (body) => {
    expect((await PATCH(request(body), { params: { id } })).status).toBe(400);
    expect(m.execute).not.toHaveBeenCalled();
  });
  it('rejects writes for a technician', async () => {
    m.auth.role = 'technikus';
    expect((await PATCH(request({ treatmentPlan: 'Terv', expectedVersion: 0 }), { params: { id } })).status).toBe(403);
    expect(m.execute).not.toHaveBeenCalled();
  });
  it('shows a migration error without pretending the plan is empty', async () => {
    m.schema.mockResolvedValue(false);
    expect((await GET(request(), { params: { id } })).status).toBe(503);
    expect(m.execute).not.toHaveBeenCalled();
  });
  it('stores upper and lower plans atomically, leaving the old common text untouched', async () => {
    const res = await PATCH(request({ treatmentPlanUpper: ' Felső terv ', treatmentPlanLower: ' Alsó terv ', expectedVersion: 1 }), { params: { id } });
    expect(res.status).toBe(200);
    expect(m.execute.mock.calls[0][2]).toMatchObject({expectedVersion:1,narratives:{treatmentPlanUpper:'Felső terv',treatmentPlanLower:'Alsó terv'}});
  });
  it.each([
    { treatmentPlanUpper: 'Csak felső', expectedVersion: 0 },
    { treatmentPlanUpper: 'Felső', treatmentPlanLower: 42, expectedVersion: 0 },
    { treatmentPlanUpper: 'Felső', treatmentPlanLower: null, treatmentPlan: 'Közös', expectedVersion: 0 },
    { treatmentPlanUpper: 'x'.repeat(MAX_EPISODE_TREATMENT_PLAN_LENGTH + 1), treatmentPlanLower: null, expectedVersion: 0 },
  ])('rejects incomplete or invalid jaw updates before writing', async (body) => {
    expect((await PATCH(request(body), { params: { id } })).status).toBe(400);
    expect(m.execute).not.toHaveBeenCalled();
  });

});
