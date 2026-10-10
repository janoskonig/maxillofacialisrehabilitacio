import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { GET, PATCH } from '@/app/api/episodes/[id]/treatment-plan/route';
import { loadNeakTreatmentSources } from '@/lib/neak-treatment-sources';
import { buildTreatmentExportContent } from '@/lib/neak-treatment-content';
import { cleanupCreated, createTestEpisode, createTestPatient, createTestUser } from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';
afterEach(cleanupCreated);

async function fixture() {
  const u = await createTestUser(undefined, { role: 'admin' });
  const patient = await createTestPatient();
  const a = await createTestEpisode(undefined, patient.id);
  const b = await createTestEpisode(undefined, patient.id);
  return { user: { id: u.id, email: u.email, role: 'admin' } as TestAuthUser, patient, a, b };
}
async function save(id: string, user: TestAuthUser, treatmentPlan: string | null, expectedVersion: number) {
  return PATCH(await authedRequest(`http://test.local/api/episodes/${id}/treatment-plan`, { user, method: 'PATCH', body: { treatmentPlan, expectedVersion } }), { params: { id } });
}
describe('Episode treatment plan persistence', () => {
  it('saves a separate plan per episode, reloads it and exports the recorded text', async () => {
    const { user, patient, a, b } = await fixture();
    expect((await save(a.id, user, 'Felső állcsont egyéni kezelési terve.\nMásodik sor.', 0)).status).toBe(200);
    expect((await save(b.id, user, 'Alsó állcsont külön terve.', 0)).status).toBe(200);
    const res = await GET(await authedRequest(`http://test.local/api/episodes/${a.id}/treatment-plan`, { user }), { params: { id: a.id } });
    expect((await res.json()).plan).toMatchObject({ treatmentPlan: 'Felső állcsont egyéni kezelési terve.\nMásodik sor.', version: 1 });
    const sources = await loadNeakTreatmentSources(getDbPool(), patient.id);
    const text = buildTreatmentExportContent({}, sources).sections.flatMap((s) => s.lines).join('\n');
    expect(text).toContain('Felső állcsont egyéni kezelési terve.\nMásodik sor.');
    expect(text).toContain('Alsó állcsont külön terve.');
  });
  it('allows exactly one of two concurrent updates, preserving the winning text', async () => {
    const { user, a } = await fixture();
    const responses = await Promise.all([save(a.id, user, 'Első szerkesztő terve', 0), save(a.id, user, 'Második szerkesztő terve', 0)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = await responses.find((r) => r.status === 200)!.json();
    const loser = await responses.find((r) => r.status === 409)!.json();
    expect(loser.plan).toEqual(winner.plan);
    expect(winner.plan.version).toBe(1);
    expect((await save(a.id, user, null, 1)).status).toBe(200);
    const row = (await getDbPool().query('SELECT treatment_plan, treatment_plan_version FROM patient_episodes WHERE id = $1', [a.id])).rows[0];
    expect(row).toEqual({ treatment_plan: null, treatment_plan_version: 2 });
  });
});
