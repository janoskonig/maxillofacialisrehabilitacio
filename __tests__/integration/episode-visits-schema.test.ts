import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { withRollback } from './helpers/db';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestUser,
} from './helpers/factories';
import {
  cleanupCreatedWp41a,
  createWp41aWorkPhase,
  getWp41aPhaseRow,
  listWp41aVisits,
} from './helpers/factories-wp41a';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { backfillEpisodeVisits } from '@/lib/episode-visits-backfill';
import {
  GET as getWorkPhases,
  POST as createWorkPhase,
} from '@/app/api/episodes/[id]/work-phases/route';
import { POST as mergeWorkPhases } from '@/app/api/episodes/[id]/work-phases/merge/route';
import { POST as unmergeWorkPhases } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/unmerge/route';
import { DELETE as deleteWorkPhase } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';

/**
 * WP-4.1a: vizit-séma (089-es migráció) — viselkedési tesztek.
 *
 * (a) backfill: merge-csoport → EGY vizit, magányos sor → saját vizit,
 *     seq-sorrend helyes, idempotens;
 * (b) új fázis felvétele (add-step route) → automatikusan vizitet kap;
 * (c) merge → közös vizit, unmerge → új vizit;
 * (d) GET visszaadja a visit/jaw/teeth mezőket és a visits[] metaadatot.
 *
 * A backfill-assertek az epizódra szűkítettek (nem globális darabszámok): a
 * maxfac_test közös DB, párhuzamos futás más sorait nem számolhatjuk.
 */

afterEach(async () => {
  await cleanupCreatedWp41a();
  await cleanupCreated();
});

async function makeDoctor(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

describe('WP-4.1a vizit-séma', () => {
  it('(a) backfill: merge-csoport egy vizitet kap, magányos sor sajátot, seq-sorrendben, idempotensen', async () => {
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);

      // Merge-csoport: A (primary) + B (rá mutató gyerek); magányos: C.
      const a = await createWp41aWorkPhase(client, episode.id, {
        workPhaseCode: 'lenyomat',
        seq: 0,
        defaultDaysOffset: 5,
      });
      const b = await createWp41aWorkPhase(client, episode.id, {
        workPhaseCode: 'probafazis',
        seq: 1,
        defaultDaysOffset: 3,
        mergedInto: a.id,
      });
      const c = await createWp41aWorkPhase(client, episode.id, {
        workPhaseCode: 'atadas',
        seq: 2,
        defaultDaysOffset: 14,
      });

      await backfillEpisodeVisits(client);

      const aRow = await getWp41aPhaseRow(client, a.id);
      const bRow = await getWp41aPhaseRow(client, b.id);
      const cRow = await getWp41aPhaseRow(client, c.id);

      // A csoport EGY vizitet kap, a magányos sajátot.
      expect(aRow?.visit_id).toBeTruthy();
      expect(bRow?.visit_id).toBe(aRow?.visit_id);
      expect(cRow?.visit_id).toBeTruthy();
      expect(cRow?.visit_id).not.toBe(aRow?.visit_id);

      // Vizit-metaadatok: 2 vizit, 0-tól sorszámozva a primary sorrendben;
      // days_offset = a primary default_days_offset-je; label NULL.
      const visits = await listWp41aVisits(client, episode.id);
      expect(visits).toHaveLength(2);
      expect(visits[0].id).toBe(aRow?.visit_id);
      expect(visits[0].seq).toBe(0);
      expect(visits[0].days_offset).toBe(5);
      expect(visits[0].label).toBeNull();
      expect(visits[1].id).toBe(cRow?.visit_id);
      expect(visits[1].seq).toBe(1);
      expect(visits[1].days_offset).toBe(14);

      // Idempotens: a második futás nem hoz létre új vizitet és nem ír át
      // hozzárendelést ezen az epizódon.
      await backfillEpisodeVisits(client);
      const visitsAfter = await listWp41aVisits(client, episode.id);
      expect(visitsAfter.map((v) => v.id)).toEqual(visits.map((v) => v.id));
      expect((await getWp41aPhaseRow(client, a.id))?.visit_id).toBe(aRow?.visit_id);
      expect((await getWp41aPhaseRow(client, b.id))?.visit_id).toBe(aRow?.visit_id);
      expect((await getWp41aPhaseRow(client, c.id))?.visit_id).toBe(cRow?.visit_id);
    });
  });

  it('(a2) backfill: láncolt (3 mélységű) merge-csoport EGY vizitet kap egyetlen futással', async () => {
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);

      // Lánc: C → B → A (A a primary; B az A gyereke; C a B gyereke).
      // A review-hiba: egyetlen set-alapú gyerek-UPDATE a statement-snapshotból
      // olvas, így a lánc alja (C) visit_id NULL-lal maradna.
      const a = await createWp41aWorkPhase(client, episode.id, {
        workPhaseCode: 'lenyomat',
        seq: 0,
        defaultDaysOffset: 5,
      });
      const b = await createWp41aWorkPhase(client, episode.id, {
        workPhaseCode: 'probafazis',
        seq: 1,
        mergedInto: a.id,
      });
      const c = await createWp41aWorkPhase(client, episode.id, {
        workPhaseCode: 'atadas',
        seq: 2,
        mergedInto: b.id,
      });

      // EGYETLEN futás — két futás nélkül is mindhárom sornak vizitet kell kapnia.
      const result = await backfillEpisodeVisits(client);
      expect(result.childrenLinked).toBeGreaterThanOrEqual(2);

      const aRow = await getWp41aPhaseRow(client, a.id);
      const bRow = await getWp41aPhaseRow(client, b.id);
      const cRow = await getWp41aPhaseRow(client, c.id);
      expect(aRow?.visit_id).toBeTruthy();
      expect(bRow?.visit_id).toBe(aRow?.visit_id);
      expect(cRow?.visit_id).toBe(aRow?.visit_id);

      const visits = await listWp41aVisits(client, episode.id);
      expect(visits).toHaveLength(1);
      expect(visits[0].id).toBe(aRow?.visit_id);
    });
  });

  it('(b) új fázis felvétele (add-step route) automatikusan egyfős vizitet kap a lista végére', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const req1 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases`,
      {
        user: doctor,
        method: 'POST',
        body: { label: 'Vizit teszt fázis', defaultDaysOffset: 10 },
      }
    );
    const res1 = await createWorkPhase(req1, { params: { id: episode.id } });
    expect(res1.status).toBe(201);
    const created1 = (await res1.json()).workPhase;
    expect(created1.visitId).toBeTruthy();

    const visits1 = await listWp41aVisits(undefined, episode.id);
    expect(visits1).toHaveLength(1);
    expect(visits1[0].id).toBe(created1.visitId);
    expect(visits1[0].seq).toBe(0);
    expect(visits1[0].days_offset).toBe(10);

    // Második fázis → új vizit a lista végére (seq = max+1).
    const req2 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases`,
      {
        user: doctor,
        method: 'POST',
        body: { label: 'Második fázis', defaultDaysOffset: 21 },
      }
    );
    const res2 = await createWorkPhase(req2, { params: { id: episode.id } });
    expect(res2.status).toBe(201);
    const created2 = (await res2.json()).workPhase;
    expect(created2.visitId).toBeTruthy();
    expect(created2.visitId).not.toBe(created1.visitId);

    const visits2 = await listWp41aVisits(undefined, episode.id);
    expect(visits2).toHaveLength(2);
    expect(visits2[1].id).toBe(created2.visitId);
    expect(visits2[1].seq).toBe(1);
    expect(visits2[1].days_offset).toBe(21);
  });

  it('(c) merge → közös vizit (a kiürült vizit törlődik), unmerge → új egyfős vizit', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    // Két fázis a normál (vizites) úton — mindkettő saját vizitben születik.
    const mk = async (label: string, offset: number) => {
      const req = await authedRequest(
        `http://test.local/api/episodes/${episode.id}/work-phases`,
        { user: doctor, method: 'POST', body: { label, defaultDaysOffset: offset } }
      );
      const res = await createWorkPhase(req, { params: { id: episode.id } });
      expect(res.status).toBe(201);
      return (await res.json()).workPhase as { id: string; visitId: string };
    };
    const a = await mk('Fő fázis', 5);
    const b = await mk('Beolvasztott fázis', 3);
    expect(a.visitId).not.toBe(b.visitId);

    // MERGE: a gyerek a primary vizitjébe kerül, a kiürült vizit törlődik.
    const mergeReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/merge`,
      { user: doctor, method: 'POST', body: { stepIds: [a.id, b.id] } }
    );
    const mergeRes = await mergeWorkPhases(mergeReq, { params: { id: episode.id } });
    expect(mergeRes.status).toBe(200);

    const aAfterMerge = await getWp41aPhaseRow(undefined, a.id);
    const bAfterMerge = await getWp41aPhaseRow(undefined, b.id);
    expect(bAfterMerge?.visit_id).toBe(aAfterMerge?.visit_id);
    expect(aAfterMerge?.visit_id).toBe(a.visitId);

    const visitsAfterMerge = await listWp41aVisits(undefined, episode.id);
    expect(visitsAfterMerge).toHaveLength(1);
    expect(visitsAfterMerge[0].id).toBe(a.visitId);

    // A merged_into kompat-mező a régi módon íródik.
    const pool = getDbPool();
    const compat = await pool.query(
      `SELECT merged_into_episode_work_phase_id FROM episode_work_phases WHERE id = $1`,
      [b.id]
    );
    expect(compat.rows[0].merged_into_episode_work_phase_id).toBe(a.id);

    // UNMERGE: a kiengedett fázis új egyfős vizitet kap a lista végére.
    const unmergeReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${a.id}/unmerge`,
      { user: doctor, method: 'POST' }
    );
    const unmergeRes = await unmergeWorkPhases(unmergeReq, {
      params: { id: episode.id, workPhaseId: a.id },
    });
    expect(unmergeRes.status).toBe(200);

    const bAfterUnmerge = await getWp41aPhaseRow(undefined, b.id);
    expect(bAfterUnmerge?.visit_id).toBeTruthy();
    expect(bAfterUnmerge?.visit_id).not.toBe(a.visitId);

    const visitsAfterUnmerge = await listWp41aVisits(undefined, episode.id);
    expect(visitsAfterUnmerge).toHaveLength(2);
    const newVisit = visitsAfterUnmerge.find((v) => v.id === bAfterUnmerge?.visit_id);
    expect(newVisit?.seq).toBe(1);
    expect(newVisit?.days_offset).toBe(3);
  });

  it('(c2) merge vizit nélküli (backfill előtti) sorokon: a primary friss vizitet kap és a gyerek csatlakozik', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    // Történelmi állapot: factory-sorok visit_id nélkül.
    const a = await createWp41aWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      defaultDaysOffset: 9,
    });
    const b = await createWp41aWorkPhase(undefined, episode.id, {
      workPhaseCode: 'atadas',
      seq: 1,
    });

    const mergeReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/merge`,
      { user: doctor, method: 'POST', body: { stepIds: [a.id, b.id] } }
    );
    const mergeRes = await mergeWorkPhases(mergeReq, { params: { id: episode.id } });
    expect(mergeRes.status).toBe(200);

    const aRow = await getWp41aPhaseRow(undefined, a.id);
    const bRow = await getWp41aPhaseRow(undefined, b.id);
    expect(aRow?.visit_id).toBeTruthy();
    expect(bRow?.visit_id).toBe(aRow?.visit_id);

    const visits = await listWp41aVisits(undefined, episode.id);
    expect(visits).toHaveLength(1);
    expect(visits[0].days_offset).toBe(9);
  });

  it('(c3) láncolt merge a route-on át: egy vizit, lapos merged_into', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const mk = async (label: string, offset: number) => {
      const req = await authedRequest(
        `http://test.local/api/episodes/${episode.id}/work-phases`,
        { user: doctor, method: 'POST', body: { label, defaultDaysOffset: offset } }
      );
      const res = await createWorkPhase(req, { params: { id: episode.id } });
      expect(res.status).toBe(201);
      return (await res.json()).workPhase as { id: string; visitId: string };
    };
    const a = await mk('A fázis', 5);
    const b = await mk('B fázis', 3);
    const c = await mk('C fázis', 7);

    // 1. kör: B → A (meglévő csoport A primaryvel).
    const merge1 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/merge`,
      { user: doctor, method: 'POST', body: { stepIds: [a.id, b.id] } }
    );
    expect((await mergeWorkPhases(merge1, { params: { id: episode.id } })).status).toBe(200);

    // 2. kör: [C, A] — A-nak saját gyereke van (B). A review-hiba: B a régi
    // vizitben maradna, és a lánc mély lenne (B → A → C).
    const merge2 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/merge`,
      { user: doctor, method: 'POST', body: { stepIds: [c.id, a.id] } }
    );
    expect((await mergeWorkPhases(merge2, { params: { id: episode.id } })).status).toBe(200);

    // Lapos lánc: A és B is KÖZVETLENÜL C-re mutat.
    const pool = getDbPool();
    const chain = await pool.query(
      `SELECT id, merged_into_episode_work_phase_id FROM episode_work_phases WHERE id = ANY($1)`,
      [[a.id, b.id, c.id]]
    );
    const mergedInto = new Map(
      (chain.rows as Array<{ id: string; merged_into_episode_work_phase_id: string | null }>).map(
        (r) => [r.id, r.merged_into_episode_work_phase_id]
      )
    );
    expect(mergedInto.get(c.id)).toBeNull();
    expect(mergedInto.get(a.id)).toBe(c.id);
    expect(mergedInto.get(b.id)).toBe(c.id);

    // A csoport EGY vizitben van (C vizitjében), az epizódnak egy vizitje maradt.
    const aRow = await getWp41aPhaseRow(undefined, a.id);
    const bRow = await getWp41aPhaseRow(undefined, b.id);
    const cRow = await getWp41aPhaseRow(undefined, c.id);
    expect(cRow?.visit_id).toBe(c.visitId);
    expect(aRow?.visit_id).toBe(c.visitId);
    expect(bRow?.visit_id).toBe(c.visitId);

    const visits = await listWp41aVisits(undefined, episode.id);
    expect(visits).toHaveLength(1);
    expect(visits[0].id).toBe(c.visitId);
  });

  it('(c4) fázis törlése után nem marad árva üres vizit', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases`,
      { user: doctor, method: 'POST', body: { label: 'Törlendő fázis', defaultDaysOffset: 4 } }
    );
    const res = await createWorkPhase(req, { params: { id: episode.id } });
    expect(res.status).toBe(201);
    const phase = (await res.json()).workPhase as { id: string; visitId: string };

    const visitsBefore = await listWp41aVisits(undefined, episode.id);
    expect(visitsBefore).toHaveLength(1);

    const delReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${phase.id}`,
      { user: doctor, method: 'DELETE' }
    );
    const delRes = await deleteWorkPhase(delReq, {
      params: { id: episode.id, workPhaseId: phase.id },
    });
    expect(delRes.status).toBe(200);

    // A kiürült egyfős vizit a törléssel együtt tűnik el.
    const visitsAfter = await listWp41aVisits(undefined, episode.id);
    expect(visitsAfter).toHaveLength(0);
  });

  it('(d) GET visszaadja a visit_id/jaw/teeth mezőket és a visits[] metaadatot', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases`,
      { user: doctor, method: 'POST', body: { label: 'Korona előkészítés', defaultDaysOffset: 6 } }
    );
    const res = await createWorkPhase(req, { params: { id: episode.id } });
    expect(res.status).toBe(201);
    const phase = (await res.json()).workPhase as { id: string; visitId: string };

    // Állcsont- és fog-hatókör közvetlenül (a PATCH-bővítés a WP-4.2 dolga).
    const pool = getDbPool();
    await pool.query(`UPDATE episode_work_phases SET jaw = 'felso' WHERE id = $1`, [phase.id]);
    await pool.query(
      `INSERT INTO episode_work_phase_teeth (episode_work_phase_id, tooth_number)
       VALUES ($1, '11'), ($1, '12')`,
      [phase.id]
    );

    const getReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases`,
      { user: doctor }
    );
    const getRes = await getWorkPhases(getReq, { params: { id: episode.id } });
    expect(getRes.status).toBe(200);
    const json = await getRes.json();

    const row = (json.workPhases as Array<Record<string, unknown>>).find(
      (p) => p.id === phase.id
    );
    expect(row).toBeTruthy();
    expect(row?.visitId).toBe(phase.visitId);
    expect(row?.jaw).toBe('felso');
    expect(row?.teeth).toEqual(['11', '12']);

    expect(Array.isArray(json.visits)).toBe(true);
    expect(json.visits).toHaveLength(1);
    expect(json.visits[0]).toMatchObject({
      id: phase.visitId,
      seq: 0,
      label: null,
      daysOffset: 6,
    });
  });
});
