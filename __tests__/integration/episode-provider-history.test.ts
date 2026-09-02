/**
 * Felelős orvos az epizódon — váltás-napló (provider_assignment_events).
 *
 *  - PATCH /api/episodes/:id assignedProviderId: a váltás rögzül (régi → új,
 *    indok, ki); változatlan orvosnál nincs sor; lekapcsolás (null) is rögzül
 *    (092: new_user_id nullable); ismeretlen orvos → 400 és nincs változás;
 *  - GET /api/episodes/:id/provider-history: névvel, legfrissebb elöl.
 *
 * Route-handlereket hívunk → pool + afterEach takarítás. A provider_assignment_events
 * sorok az epizóddal kaszkádolva törlődnek.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestUser,
} from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { PATCH as episodePatch } from '@/app/api/episodes/[id]/route';
import { GET as providerHistoryGet } from '@/app/api/episodes/[id]/provider-history/route';

afterEach(async () => {
  await cleanupCreated();
});

async function authUser(): Promise<TestAuthUser> {
  const u = await createTestUser(undefined, { role: 'admin' });
  return { id: u.id, email: u.email, role: 'admin' };
}

async function patchProvider(episodeId: string, user: TestAuthUser, body: Record<string, unknown>) {
  const req = await authedRequest(`http://test.local/api/episodes/${episodeId}`, {
    user,
    method: 'PATCH',
    body,
  });
  return episodePatch(req, { params: { id: episodeId } });
}

async function events(episodeId: string) {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT old_user_id, new_user_id, reason, created_by FROM provider_assignment_events
     WHERE episode_id = $1 ORDER BY created_at, id`,
    [episodeId]
  );
  return rows as Array<{ old_user_id: string | null; new_user_id: string | null; reason: string | null; created_by: string | null }>;
}

describe('Felelős orvos — váltás-napló', () => {
  it('kijelölés, átadás indokkal és lekapcsolás mind rögzül; változatlan orvos nem', async () => {
    const pool = getDbPool();
    // Az orvosok ELŐBB születnek, mint az epizód: a cleanup fordított sorrendben
    // töröl, így az epizód (kaszkádolt naplóval) előbb tűnik el, mint a user-ek.
    const drA = await createTestUser(undefined, { doktorNeve: 'Dr. Első Anna' });
    const drB = await createTestUser(undefined, { doktorNeve: 'Dr. Második Béla' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const user = await authUser();

    // 1) első kijelölés (régi: nincs)
    let res = await patchProvider(episode.id, user, { assignedProviderId: drA.id });
    expect(res.status).toBe(200);
    // 2) ugyanaz újra → nincs új sor
    res = await patchProvider(episode.id, user, { assignedProviderId: drA.id });
    expect(res.status).toBe(200);
    // 3) átadás indokkal
    res = await patchProvider(episode.id, user, {
      assignedProviderId: drB.id,
      providerChangeReason: 'Szabadság miatt átadva',
    });
    expect(res.status).toBe(200);
    // 4) lekapcsolás
    res = await patchProvider(episode.id, user, { assignedProviderId: null });
    expect(res.status).toBe(200);

    const rows = await events(episode.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ old_user_id: null, new_user_id: drA.id, reason: null });
    expect(rows[1]).toMatchObject({ old_user_id: drA.id, new_user_id: drB.id, reason: 'Szabadság miatt átadva' });
    expect(rows[2]).toMatchObject({ old_user_id: drB.id, new_user_id: null });
    expect(rows.every((r) => r.created_by === user.email)).toBe(true);

    const ep = await pool.query(`SELECT assigned_provider_id FROM patient_episodes WHERE id = $1`, [episode.id]);
    expect(ep.rows[0].assigned_provider_id).toBeNull();
  });

  it('ismeretlen orvos → 400, az epizód és a napló változatlan', async () => {
    const pool = getDbPool();
    const drA = await createTestUser(undefined, { doktorNeve: 'Dr. Első Anna' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const user = await authUser();
    expect((await patchProvider(episode.id, user, { assignedProviderId: drA.id })).status).toBe(200);

    const res = await patchProvider(episode.id, user, {
      assignedProviderId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('PROVIDER_NOT_FOUND');
    const ep = await pool.query(`SELECT assigned_provider_id FROM patient_episodes WHERE id = $1`, [episode.id]);
    expect(ep.rows[0].assigned_provider_id).toBe(drA.id);
    expect(await events(episode.id)).toHaveLength(1);
  });

  it('GET provider-history: nevekkel, legfrissebb elöl', async () => {
    const drA = await createTestUser(undefined, { doktorNeve: 'Dr. Első Anna' });
    const drB = await createTestUser(undefined, { doktorNeve: 'Dr. Második Béla' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const user = await authUser();
    await patchProvider(episode.id, user, { assignedProviderId: drA.id });
    await patchProvider(episode.id, user, { assignedProviderId: drB.id, providerChangeReason: 'Átadás' });

    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/provider-history`, { user });
    const res = await providerHistoryGet(req, { params: { id: episode.id } });
    expect(res.status).toBe(200);
    const { events: list } = await res.json();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ oldName: 'Dr. Első Anna', newName: 'Dr. Második Béla', reason: 'Átadás' });
    expect(list[1]).toMatchObject({ oldUserId: null, oldName: null, newName: 'Dr. Első Anna' });
  });
});
