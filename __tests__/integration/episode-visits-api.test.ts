/**
 * WP-4.2 — vizit CRUD API + fázis-áthelyezés / hatókör (jaw, teeth) PATCH.
 *
 * Route-handlereket hívunk, ezért a factory-k pool-lal (db nélkül) futnak és
 * afterEach-ben takarítunk (docs/INTEGRATION_TESTS.md, 2. minta).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestUser,
} from './helpers/factories';
import { cleanupCreatedWp41a, createWp41aWorkPhase } from './helpers/factories-wp41a';
import { backfillEpisodeVisits } from '@/lib/episode-visits-backfill';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { POST as createVisitPost, PATCH as reorderVisitsPatch } from '@/app/api/episodes/[id]/visits/route';
import {
  PATCH as visitPatch,
  DELETE as visitDelete,
} from '@/app/api/episodes/[id]/visits/[visitId]/route';
import { PATCH as workPhasePatch } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';

afterEach(async () => {
  await cleanupCreatedWp41a();
  await cleanupCreated();
});

async function authUser(): Promise<TestAuthUser> {
  const u = await createTestUser();
  return { id: u.id, email: u.email, role: 'fogpótlástanász' };
}

async function seedEpisodeWithVisits() {
  const pool = getDbPool();
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  const p1 = await createWp41aWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    seq: 0,
    defaultDaysOffset: 7,
  });
  const p2 = await createWp41aWorkPhase(undefined, episode.id, {
    workPhaseCode: 'atadas',
    seq: 1,
    defaultDaysOffset: 10,
  });
  await backfillEpisodeVisits(pool, episode.id as string);
  const visits = await pool.query(
    `SELECT id, seq FROM episode_visits WHERE episode_id = $1 ORDER BY seq`,
    [episode.id]
  );
  return { pool, episode, p1, p2, visits: visits.rows as Array<{ id: string; seq: number }> };
}

describe('WP-4.2 — vizit CRUD', () => {
  it('POST új üres alkalmat ad a lista végére; DELETE csak üreset töröl', async () => {
    const { pool, episode, visits } = await seedEpisodeWithVisits();
    const user = await authUser();

    const createReq = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'POST',
      body: { label: 'Kombinált alkalom', daysOffset: 5 },
    });
    const createRes = await createVisitPost(createReq, { params: { id: episode.id } });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).visit;
    expect(created.seq).toBe(visits.length); // a lista végére

    // Nem-üres vizit törlése → 409 (ajánlat-nyelvezetű hiba).
    const delBusyReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${visits[0].id}`,
      { user, method: 'DELETE' }
    );
    const delBusyRes = await visitDelete(delBusyReq, {
      params: { id: episode.id, visitId: visits[0].id },
    });
    expect(delBusyRes.status).toBe(409);
    expect((await delBusyRes.json()).code).toBe('VISIT_NOT_EMPTY');

    // Az üres, most létrehozott alkalom törölhető.
    const delReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${created.id}`,
      { user, method: 'DELETE' }
    );
    const delRes = await visitDelete(delReq, { params: { id: episode.id, visitId: created.id } });
    expect(delRes.status).toBe(200);
    const after = await pool.query(`SELECT 1 FROM episode_visits WHERE id = $1`, [created.id]);
    expect(after.rows).toHaveLength(0);

    // Audit: visit_change sorok születtek (létrehozás + törlés).
    const audit = await pool.query(
      `SELECT COUNT(*)::int AS c FROM episode_work_phase_audit
       WHERE episode_id = $1 AND change_type = 'visit_change'`,
      [episode.id]
    );
    expect(audit.rows[0].c).toBeGreaterThanOrEqual(2);
  });

  it('PATCH metaadat (label/daysOffset) módosít; kollekció-PATCH átrendez', async () => {
    const { pool, episode, visits } = await seedEpisodeWithVisits();
    const user = await authUser();

    const metaReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${visits[0].id}`,
      { user, method: 'PATCH', body: { label: 'Első alkalom', daysOffset: 21 } }
    );
    const metaRes = await visitPatch(metaReq, {
      params: { id: episode.id, visitId: visits[0].id },
    });
    expect(metaRes.status).toBe(200);
    const updated = (await metaRes.json()).visit;
    expect(updated.label).toBe('Első alkalom');
    expect(updated.daysOffset).toBe(21);

    // Átrendezés: fordított sorrend.
    const reordered = [...visits].reverse().map((v) => v.id);
    const reorderReq = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'PATCH',
      body: { orderedVisitIds: reordered },
    });
    const reorderRes = await reorderVisitsPatch(reorderReq, { params: { id: episode.id } });
    expect(reorderRes.status).toBe(200);
    const afterOrder = await pool.query(
      `SELECT id FROM episode_visits WHERE episode_id = $1 ORDER BY seq`,
      [episode.id]
    );
    expect(afterOrder.rows.map((r: { id: string }) => r.id)).toEqual(reordered);

    // Hiányos halmaz → 409.
    const badReq = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'PATCH',
      body: { orderedVisitIds: [visits[0].id] },
    });
    const badRes = await reorderVisitsPatch(badReq, { params: { id: episode.id } });
    expect(badRes.status).toBe(409);
  });

  it('lezárt epizódon a vizit-műveletek 409 EPISODE_NOT_OPEN-t adnak', async () => {
    const { pool, episode } = await seedEpisodeWithVisits();
    const user = await authUser();
    await pool.query(`UPDATE patient_episodes SET status = 'closed' WHERE id = $1`, [episode.id]);

    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'POST',
      body: {},
    });
    const res = await createVisitPost(req, { params: { id: episode.id } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('EPISODE_NOT_OPEN');

    await pool.query(`UPDATE patient_episodes SET status = 'open' WHERE id = $1`, [episode.id]);
  });
});

describe('WP-4.2 — fázis-áthelyezés és hatókör a work-phase PATCH-en', () => {
  it('visitId: a fázis átköltözik, a kiürült alkalom törlődik, audit visit_change', async () => {
    const { pool, episode, p1, visits } = await seedEpisodeWithVisits();
    const user = await authUser();
    const targetVisit = visits[1];
    const sourceVisit = visits[0];

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${p1.id}`,
      { user, method: 'PATCH', body: { visitId: targetVisit.id } }
    );
    const res = await workPhasePatch(req, {
      params: { id: episode.id, workPhaseId: p1.id },
    });
    expect(res.status).toBe(200);

    const phase = await pool.query(`SELECT visit_id FROM episode_work_phases WHERE id = $1`, [p1.id]);
    expect(phase.rows[0].visit_id).toBe(targetVisit.id);
    // A kiürült forrás-alkalom nem maradt árván.
    const orphan = await pool.query(`SELECT 1 FROM episode_visits WHERE id = $1`, [sourceVisit.id]);
    expect(orphan.rows).toHaveLength(0);

    const audit = await pool.query(
      `SELECT 1 FROM episode_work_phase_audit
       WHERE episode_work_phase_id = $1 AND change_type = 'visit_change'`,
      [p1.id]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);

    // Nem az epizódhoz tartozó cél-vizit → 404.
    const otherPatient = await createTestPatient();
    const otherEpisode = await createTestEpisode(undefined, otherPatient.id);
    const foreign = await pool.query(
      `INSERT INTO episode_visits (episode_id, seq) VALUES ($1, 0) RETURNING id`,
      [otherEpisode.id]
    );
    const badReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${p1.id}`,
      { user, method: 'PATCH', body: { visitId: foreign.rows[0].id } }
    );
    const badRes = await workPhasePatch(badReq, {
      params: { id: episode.id, workPhaseId: p1.id },
    });
    expect(badRes.status).toBe(404);
    await pool.query(`DELETE FROM episode_visits WHERE id = $1`, [foreign.rows[0].id]);
  });

  it('jaw és teeth írható-olvasható, scope_change audittal; érvénytelen jaw 400', async () => {
    const { pool, episode, p2 } = await seedEpisodeWithVisits();
    const user = await authUser();

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${p2.id}`,
      { user, method: 'PATCH', body: { jaw: 'felso', teeth: ['11', '12', 21] } }
    );
    const res = await workPhasePatch(req, {
      params: { id: episode.id, workPhaseId: p2.id },
    });
    expect(res.status).toBe(200);

    const phase = await pool.query(`SELECT jaw FROM episode_work_phases WHERE id = $1`, [p2.id]);
    expect(phase.rows[0].jaw).toBe('felso');
    const teeth = await pool.query(
      `SELECT tooth_number FROM episode_work_phase_teeth WHERE episode_work_phase_id = $1 ORDER BY tooth_number`,
      [p2.id]
    );
    expect(teeth.rows.map((r: { tooth_number: string }) => r.tooth_number)).toEqual(['11', '12', '21']);

    const audit = await pool.query(
      `SELECT COUNT(*)::int AS c FROM episode_work_phase_audit
       WHERE episode_work_phase_id = $1 AND change_type = 'scope_change'`,
      [p2.id]
    );
    expect(audit.rows[0].c).toBeGreaterThanOrEqual(2); // jaw + teeth

    const badReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${p2.id}`,
      { user, method: 'PATCH', body: { jaw: 'oldalso' } }
    );
    const badRes = await workPhasePatch(badReq, {
      params: { id: episode.id, workPhaseId: p2.id },
    });
    expect(badRes.status).toBe(400);
  });
});

describe('WP-4.2 — review-javítások', () => {
  it('status + hatókör-mező kombinálva 400 (nem vész el némán)', async () => {
    const { p1, episode } = await seedEpisodeWithVisits();
    const user = await authUser();
    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${p1.id}`,
      { user, method: 'PATCH', body: { status: 'completed', jaw: 'felso' } }
    );
    const res = await workPhasePatch(req, { params: { id: episode.id, workPhaseId: p1.id } });
    expect(res.status).toBe(400);
  });

  it('merge-csoport primary-jének áthelyezése a rejtett gyerekeket is viszi', async () => {
    const pool = getDbPool();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const primary = await createWp41aWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
    });
    const child = await createWp41aWorkPhase(undefined, episode.id, {
      workPhaseCode: 'harapasregisztracio',
      seq: 1,
      mergedInto: primary.id,
    });
    await backfillEpisodeVisits(pool, episode.id as string);
    const user = await authUser();

    const createReq = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'POST',
      body: { label: 'Cél-alkalom' },
    });
    const createRes = await createVisitPost(createReq, { params: { id: episode.id } });
    const target = (await createRes.json()).visit;

    const moveReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${primary.id}`,
      { user, method: 'PATCH', body: { visitId: target.id } }
    );
    const moveRes = await workPhasePatch(moveReq, {
      params: { id: episode.id, workPhaseId: primary.id },
    });
    expect(moveRes.status).toBe(200);

    const rows = await pool.query(
      `SELECT id, visit_id FROM episode_work_phases WHERE id = ANY($1::uuid[])`,
      [[primary.id, child.id]]
    );
    for (const r of rows.rows) expect(r.visit_id).toBe(target.id);
    // A régi (kiürült) csoport-vizit nem maradt árván.
    const visits = await pool.query(
      `SELECT id FROM episode_visits WHERE episode_id = $1`,
      [episode.id]
    );
    expect(visits.rows).toHaveLength(1);
    expect(visits.rows[0].id).toBe(target.id);
  });

  it('a vizit-átrendezés az EWP fázis-sorrendet is átszámozza (forecast-konzisztencia)', async () => {
    const { pool, episode, p1, p2, visits } = await seedEpisodeWithVisits();
    const user = await authUser();

    // p1 (lenyomat) az első vizitben, p2 (atadas) a másodikban — fordítsuk meg.
    const reordered = [...visits].reverse().map((v) => v.id);
    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'PATCH',
      body: { orderedVisitIds: reordered },
    });
    const res = await reorderVisitsPatch(req, { params: { id: episode.id } });
    expect(res.status).toBe(200);

    const order = await pool.query(
      `SELECT id FROM episode_work_phases WHERE episode_id = $1
       ORDER BY COALESCE(seq, pathway_order_index), pathway_order_index`,
      [episode.id]
    );
    // A forecast/next-step sorrend-igazsága most az új vizit-sorrendet követi:
    // p2 (atadas) megelőzi p1-et (lenyomat).
    expect(order.rows.map((r: { id: string }) => r.id)).toEqual([p2.id, p1.id]);
  });

  it('duplikált id az orderedVisitIds-ben 400', async () => {
    const { episode, visits } = await seedEpisodeWithVisits();
    const user = await authUser();
    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'PATCH',
      body: { orderedVisitIds: [visits[0].id, visits[0].id, visits[1].id] },
    });
    const res = await reorderVisitsPatch(req, { params: { id: episode.id } });
    expect(res.status).toBe(400);
  });

  it('nem-objektum JSON body 400 (nem 500)', async () => {
    const { episode, visits } = await seedEpisodeWithVisits();
    const user = await authUser();
    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'POST',
      body: null,
    });
    const res = await createVisitPost(req, { params: { id: episode.id } });
    expect(res.status).toBe(400);

    const patchReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${visits[0].id}`,
      { user, method: 'PATCH', body: 'csak-egy-string' as unknown as Record<string, unknown> }
    );
    const patchRes = await visitPatch(patchReq, {
      params: { id: episode.id, visitId: visits[0].id },
    });
    expect(patchRes.status).toBe(400);
  });
});

describe('WP-4.3 review-javítás — egy-kockás áthelyezés is átszámozza a fázis-sorrendet', () => {
  it('C áthelyezése az 1. alkalomba: az EWP-sorrend [A, C, B] lesz (motor = megjelenítés)', async () => {
    const pool = getDbPool();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const a = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'lenyomat', seq: 0 });
    const b = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'probafelvetel', seq: 1 });
    const c = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'atadas', seq: 2 });
    await backfillEpisodeVisits(pool, episode.id as string);
    const visits = await pool.query(
      `SELECT id FROM episode_visits WHERE episode_id = $1 ORDER BY seq`,
      [episode.id]
    );
    const firstVisitId = visits.rows[0].id;
    const user = await authUser();

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${c.id}`,
      { user, method: 'PATCH', body: { visitId: firstVisitId } }
    );
    const res = await workPhasePatch(req, { params: { id: episode.id, workPhaseId: c.id } });
    expect(res.status).toBe(200);

    const order = await pool.query(
      `SELECT id FROM episode_work_phases WHERE episode_id = $1
       ORDER BY COALESCE(seq, pathway_order_index), pathway_order_index`,
      [episode.id]
    );
    expect(order.rows.map((r: { id: string }) => r.id)).toEqual([a.id, c.id, b.id]);
  });
});
