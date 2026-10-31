import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { allPendingSteps, isBlockedAll } from '@/lib/next-step-engine';
import { createAppointment } from '@/lib/appointment-service';
import { convertIntentToAppointment } from '@/lib/convert-slot-intent';
import { POST as createObstacle, GET as episodeObstacles } from '@/app/api/episodes/[id]/blocks/route';
import { PATCH as updateObstacle } from '@/app/api/episode-blocks/[id]/route';
import { GET as waitingList } from '@/app/api/episode-blocks/route';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { cleanupCreated, createTestEpisode, createTestPatient, createTestSlot, createTestSlotIntent, createTestUser, createTestWorkPhase } from './helpers/factories';

afterEach(async () => { await cleanupCreated(); });

async function setup() {
  const doctor = await createTestUser(undefined, { role: 'admin' });
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  await createTestWorkPhase(undefined, episode.id);
  const auth: TestAuthUser = { ...doctor, role: 'admin' };
  const create = async (key = 'WAIT_QUOTE', waitingOn = 'Minta Fogtechnika') => {
    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/blocks`, { user: auth, method: 'POST', body: { key, waitingOn, waitingSince: '2020-10-01', expectedUnblockDate: '2020-10-15' } });
    const response = await createObstacle(req, { params: { id: episode.id } });
    expect(response.status).toBe(201);
    return (await response.json()).block;
  };
  const patch = async (id: string, body: unknown) => updateObstacle(
    await authedRequest(`http://test.local/api/episode-blocks/${id}`, { user: auth, method: 'PATCH', body }), { params: { id } }
  );
  const queue = async () => {
    const response = await waitingList(await authedRequest('http://test.local/api/episode-blocks', { user: auth }));
    expect(response.status).toBe(200);
    return (await response.json()).obstacles.filter((block: { episodeId: string }) => block.episodeId === episode.id);
  };
  return { doctor, patient, episode, auth, create, patch, queue };
}

describe('persistent episode obstacles', () => {
  it('keeps overdue obstacles on the waiting list, preserves the start on edits, and clears only the resolved obstacle', async () => {
    const s = await setup();
    const quote = await s.create();
    const histology = await s.create('WAIT_HISTOLOGY', 'Minta Patológia');
    expect(quote).toMatchObject({ waitingOn: 'Minta Fogtechnika', expiresAt: null });
    expect(await s.queue()).toHaveLength(2);
    expect(await allPendingSteps(s.episode.id)).toMatchObject({ status: 'blocked', block_keys: expect.arrayContaining(['WAIT_QUOTE', 'WAIT_HISTOLOGY']) });

    const edited = await s.patch(quote.id, { action: 'update', key: 'WAIT_QUOTE', waitingOn: 'Pontosított Fogtechnika', expectedUnblockDate: '2020-10-20' });
    expect(edited.status).toBe(200);
    expect((await edited.json()).block).toMatchObject({ waitingOn: 'Pontosított Fogtechnika', waitingSince: quote.waitingSince, expiresAt: null });

    expect((await s.patch(quote.id, { action: 'resolve', resolutionNote: 'Az árajánlat megérkezett' })).status).toBe(200);
    expect((await s.queue()).map((block: { id: string }) => block.id)).toEqual([histology.id]);
    expect(isBlockedAll(await allPendingSteps(s.episode.id))).toBe(true);
    expect((await s.patch(histology.id, { action: 'resolve' })).status).toBe(200);
    expect(await s.queue()).toHaveLength(0);
    expect(isBlockedAll(await allPendingSteps(s.episode.id))).toBe(false);

    const history = await episodeObstacles(await authedRequest(`http://test.local/api/episodes/${s.episode.id}/blocks`, { user: s.auth }), { params: { id: s.episode.id } });
    expect((await history.json()).blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: quote.id, active: false, waitingSince: quote.waitingSince, resolutionNote: 'Az árajánlat megérkezett', resolvedAt: expect.any(String) }),
    ]));
    const saved = await getDbPool().query('SELECT created_by, resolved_by FROM episode_blocks WHERE id = $1', [quote.id]);
    expect(saved.rows[0]).toEqual({ created_by: s.doctor.id, resolved_by: s.doctor.id });
  });

  it('rejects direct and batch booking while the obstacle is active', async () => {
    const s = await setup();
    await s.create();
    const slot = await createTestSlot(undefined, s.doctor.id);
    const direct = await createAppointment(getDbPool(), {
      patientId: s.patient.id, episodeId: s.episode.id, timeSlotId: slot.id, pool: 'work', appointmentType: 'munkafazis', createdVia: 'worklist', requiresPrecommit: false,
    }, { email: s.doctor.email, userId: s.doctor.id, role: 'admin' });
    expect(direct).toMatchObject({ ok: false, validationError: { code: 'EPISODE_BLOCKED', status: 409, error: expect.stringContaining('Minta Fogtechnika') } });
    const intent = await createTestSlotIntent(undefined, s.episode.id);
    const batch = await convertIntentToAppointment(getDbPool(), intent.id, { userId: s.doctor.id, email: s.doctor.email, role: 'admin' }, { timeSlotId: slot.id, skipOneHardNext: true });
    expect(batch).toMatchObject({ ok: false, code: 'EPISODE_BLOCKED', status: 409 });
    expect((await getDbPool().query('SELECT id FROM appointments WHERE episode_id = $1', [s.episode.id])).rows).toHaveLength(0);
    expect((await getDbPool().query('SELECT state FROM available_time_slots WHERE id = $1', [slot.id])).rows[0].state).toBe('free');
  });

  it('enforces staff roles and keeps closed treatments off the waiting list', async () => {
    const tech = await createTestUser(undefined, { role: 'technikus' });
    const s = await setup();
    const forbidden = await createObstacle(await authedRequest(`http://test.local/api/episodes/${s.episode.id}/blocks`, { user: { ...tech, role: 'technikus' }, method: 'POST', body: { key: 'WAIT_QUOTE', waitingOn: 'Labor' } }), { params: { id: s.episode.id } });
    expect(forbidden.status).toBe(403);
    expect(await s.queue()).toHaveLength(0);
    await s.create();
    await getDbPool().query("UPDATE patient_episodes SET status = 'closed' WHERE id = $1", [s.episode.id]);
    expect(await s.queue()).toHaveLength(0);
    const response = await createObstacle(await authedRequest(`http://test.local/api/episodes/${s.episode.id}/blocks`, { user: s.auth, method: 'POST', body: { key: 'WAIT_QUOTE', waitingOn: 'Labor' } }), { params: { id: s.episode.id } });
    expect(response.status).toBe(409);
  });
});
