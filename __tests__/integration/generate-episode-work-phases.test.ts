import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestUser,
  createTestWorkPhase,
} from './helpers/factories';
import {
  cleanupCreatedWp07,
  createWp07CarePathway,
  createWp07ToothTreatment,
  createWp07ToothTreatmentCatalogEntry,
  createWp07TreatmentType,
} from './helpers/factories-wp07';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { POST as generateWorkPhases } from '@/app/api/episodes/[id]/work-phases/generate/route';
import { GET as getWorkPhases } from '@/app/api/episodes/[id]/work-phases/route';
import { DELETE as deleteWorkPhase } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';
import { POST as addFromToothTreatment } from '@/app/api/episodes/[id]/work-phases/from-tooth-treatment/route';

/**
 * WP-0.7 (kódaudit #01 + #07): olvasás/írás szétválasztása + törlés-tombstone.
 *
 *  • #01: a terv-kártya korábban a mutáló POST .../generate-tel "olvasott",
 *    és a generate őre csak azt nézte, létezik-e MOST sor — a törölt fázis a
 *    következő betöltésnél visszakerült (élő DB-n reprodukálva: 3 completed
 *    fázis törlése után totalGenerated: 3). A fog-szinkron a törölt fog-fázist
 *    is visszatette, mert a törlés a tooth_treatments.status-hoz nem nyúlt.
 *  • #07: a 006-os migráció kifejezés-indexe miatt az ON CONFLICT
 *    (episode_id, care_pathway_id) arbiter 42P10-zel hasalt, a csupasz catch a
 *    '__legacy__' fallbackra vitt — a sablon vagy duplán szúródott be, vagy
 *    (egy ad-hoc NULL-source sor miatt) sosem generálódott le.
 *
 * Route-handlereket hívunk (a route maga COMMIT-ol), ezért a factory-k
 * pool-lal futnak és afterEach takarít.
 */

afterEach(async () => {
  await cleanupCreatedWp07();
  await cleanupCreated();
});

const TEMPLATE_CODES = ['konzultacio', 'lenyomat', 'atadas'];

async function makeDoctor(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

/** Epizód, aminek csak a legacy patient_episodes.care_pathway_id mezője mutat sablonra. */
async function makeEpisodeWithLegacyPathwayColumn(): Promise<{
  episodeId: string;
  patientId: string;
  carePathwayId: string;
}> {
  const pool = getDbPool();
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  const tt = await createWp07TreatmentType();
  const cp = await createWp07CarePathway(undefined, tt.id);
  await pool.query(`UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`, [
    cp.id,
    episode.id,
  ]);
  return { episodeId: episode.id, patientId: patient.id, carePathwayId: cp.id };
}

async function callGenerate(episodeId: string, user: TestAuthUser) {
  const req = await authedRequest(
    `http://test.local/api/episodes/${episodeId}/work-phases/generate`,
    { user, method: 'POST' }
  );
  return generateWorkPhases(req, { params: { id: episodeId } });
}

async function callGet(episodeId: string, user: TestAuthUser) {
  const req = await authedRequest(`http://test.local/api/episodes/${episodeId}/work-phases`, {
    user,
  });
  return getWorkPhases(req, { params: { id: episodeId } });
}

async function callDelete(episodeId: string, workPhaseId: string, user: TestAuthUser) {
  const req = await authedRequest(
    `http://test.local/api/episodes/${episodeId}/work-phases/${workPhaseId}`,
    { user, method: 'DELETE' }
  );
  return deleteWorkPhase(req, { params: { id: episodeId, workPhaseId } });
}

async function phaseRows(episodeId: string): Promise<Array<{
  id: string;
  work_phase_code: string;
  source_episode_pathway_id: string | null;
  tooth_treatment_id: string | null;
}>> {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT id, work_phase_code, source_episode_pathway_id, tooth_treatment_id
       FROM episode_work_phases WHERE episode_id = $1
      ORDER BY COALESCE(seq, pathway_order_index)`,
    [episodeId]
  );
  return rows;
}

describe('generate-episode-work-phases (WP-0.7)', () => {
  it('#07: a sablon a valós sémán generálódik (nem a __legacy__ fallbackon), és a kétszeri generate nem duplikál', async () => {
    const doctor = await makeDoctor();
    const { episodeId } = await makeEpisodeWithLegacyPathwayColumn();
    const pool = getDbPool();

    const res1 = await callGenerate(episodeId, doctor);
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.generated).toBe(true);
    expect(body1.workPhases).toHaveLength(TEMPLATE_CODES.length);

    const rows1 = await phaseRows(episodeId);
    expect(rows1.map((r) => r.work_phase_code)).toEqual(TEMPLATE_CODES);
    // A javítás lényege: a bootstrap INSERT tényleg lefutott, a fázisok forrása
    // a valódi episode_pathways sor — nem a NULL-os '__legacy__' ág.
    for (const row of rows1) {
      expect(row.source_episode_pathway_id).not.toBeNull();
    }
    const epPathways = await pool.query(
      `SELECT id FROM episode_pathways WHERE episode_id = $1`,
      [episodeId]
    );
    expect(epPathways.rows).toHaveLength(1);

    // Második generate: idempotens, nem duplikál.
    const res2 = await callGenerate(episodeId, doctor);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.generated).toBe(false);
    expect(await phaseRows(episodeId)).toHaveLength(TEMPLATE_CODES.length);
  });

  it('#01: a törölt sablon-fázis sem a GET-tel, sem explicit generate-tel nem éled újra', async () => {
    const doctor = await makeDoctor();
    const { episodeId } = await makeEpisodeWithLegacyPathwayColumn();
    const pool = getDbPool();

    await callGenerate(episodeId, doctor);
    const rows = await phaseRows(episodeId);
    expect(rows).toHaveLength(3);

    // Egy fázis törlése.
    const lenyomat = rows.find((r) => r.work_phase_code === 'lenyomat')!;
    const delRes = await callDelete(episodeId, lenyomat.id, doctor);
    expect(delRes.status).toBe(200);

    // (a) A terv-kártya olvasása (GET) nem hozza vissza — és nem is ír.
    const getRes = await callGet(episodeId, doctor);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.workPhases.map((w: { workPhaseCode: string }) => w.workPhaseCode)).toEqual([
      'konzultacio',
      'atadas',
    ]);

    // (b) Explicit generate után sem.
    await callGenerate(episodeId, doctor);
    expect((await phaseRows(episodeId)).map((r) => r.work_phase_code)).toEqual([
      'konzultacio',
      'atadas',
    ]);

    // Az audit #01 repróvá: az ÖSSZES fázis törlése után sem generálódik újra
    // a sablon (korábban: totalGenerated: 3, mind pending).
    for (const row of await phaseRows(episodeId)) {
      const res = await callDelete(episodeId, row.id, doctor);
      expect(res.status).toBe(200);
    }
    expect(await phaseRows(episodeId)).toHaveLength(0);

    const regenRes = await callGenerate(episodeId, doctor);
    expect(regenRes.status).toBe(200);
    expect((await regenRes.json()).generated).toBe(false);
    expect(await phaseRows(episodeId)).toHaveLength(0);

    // A tombstone-ok rögzültek a sablon-forrással.
    const tombstones = await pool.query(
      `SELECT work_phase_code, source_episode_pathway_id FROM episode_work_phase_tombstones
        WHERE episode_id = $1 ORDER BY work_phase_code`,
      [episodeId]
    );
    expect(tombstones.rows).toHaveLength(3);
    for (const t of tombstones.rows) {
      expect(t.source_episode_pathway_id).not.toBeNull();
    }
  });

  it('#01 fog-szinkron: a törölt fog-fázis nem kerül vissza, a tooth_treatments visszaáll pending-re, kézzel újra hozzáadható', async () => {
    const doctor = await makeDoctor();
    const { episodeId, patientId } = await makeEpisodeWithLegacyPathwayColumn();
    const pool = getDbPool();

    const catalog = await createWp07ToothTreatmentCatalogEntry();
    const tooth = await createWp07ToothTreatment(undefined, patientId, episodeId, catalog.code, {
      toothNumber: 21,
    });

    await callGenerate(episodeId, doctor);
    const rows = await phaseRows(episodeId);
    expect(rows).toHaveLength(4); // 3 sablon + 1 fog-fázis
    const toothPhase = rows.find((r) => r.tooth_treatment_id === tooth.id)!;
    expect(toothPhase.work_phase_code).toBe(`tooth_${catalog.code}`);

    // Törlés: a tooth_treatments visszaáll 'pending'-re + tombstone íródik.
    const delRes = await callDelete(episodeId, toothPhase.id, doctor);
    expect(delRes.status).toBe(200);

    const ttAfter = await pool.query(`SELECT status FROM tooth_treatments WHERE id = $1`, [
      tooth.id,
    ]);
    expect(ttAfter.rows[0].status).toBe('pending');

    const tombstone = await pool.query(
      `SELECT 1 FROM episode_work_phase_tombstones WHERE episode_id = $1 AND tooth_treatment_id = $2`,
      [episodeId, tooth.id]
    );
    expect(tombstone.rows).toHaveLength(1);

    // Generate nem teszi vissza (a status-szűrő miatt)...
    await callGenerate(episodeId, doctor);
    expect((await phaseRows(episodeId)).some((r) => r.tooth_treatment_id === tooth.id)).toBe(false);

    // ...és akkor sem, ha a status kézzel visszaáll 'episode_linked'-re — a
    // tombstone önmagában is véd (a régi adatokra is).
    await pool.query(`UPDATE tooth_treatments SET status = 'episode_linked' WHERE id = $1`, [
      tooth.id,
    ]);
    await callGenerate(episodeId, doctor);
    expect((await phaseRows(episodeId)).some((r) => r.tooth_treatment_id === tooth.id)).toBe(false);

    // A kézi (explicit) újra-hozzáadás viszont működik — 'pending' státuszból is.
    await pool.query(`UPDATE tooth_treatments SET status = 'pending' WHERE id = $1`, [tooth.id]);
    const addReq = await authedRequest(
      `http://test.local/api/episodes/${episodeId}/work-phases/from-tooth-treatment`,
      { user: doctor, method: 'POST', body: { toothTreatmentId: tooth.id } }
    );
    const addRes = await addFromToothTreatment(addReq, { params: { id: episodeId } });
    expect(addRes.status).toBe(201);
    expect((await phaseRows(episodeId)).some((r) => r.tooth_treatment_id === tooth.id)).toBe(true);
    const ttRelinked = await pool.query(`SELECT status FROM tooth_treatments WHERE id = $1`, [
      tooth.id,
    ]);
    expect(ttRelinked.rows[0].status).toBe('episode_linked');
  });

  it('#07: ad-hoc (NULL-source) sor nem hiúsítja meg a sablon generálását', async () => {
    const doctor = await makeDoctor();
    const { episodeId } = await makeEpisodeWithLegacyPathwayColumn();

    // Ad-hoc sor a generálás ELŐTT — a régi '__legacy__' őr
    // (source_episode_pathway_id IS NULL) ettől "kész"-nek látta a sablont.
    await createTestWorkPhase(undefined, episodeId, {
      workPhaseCode: 'adhoc_wp07_teszt',
      customLabel: 'Ad-hoc teszt lépés',
      seq: 0,
    });

    const res = await callGenerate(episodeId, doctor);
    expect(res.status).toBe(201);

    const codes = (await phaseRows(episodeId)).map((r) => r.work_phase_code);
    expect(codes).toHaveLength(4);
    for (const code of TEMPLATE_CODES) {
      expect(codes).toContain(code);
    }
    expect(codes).toContain('adhoc_wp07_teszt');
  });

  it('#07: a régi __legacy__ úton már legenerált terv mellé nem szúródik be még egyszer a sablon', async () => {
    const doctor = await makeDoctor();
    const { episodeId } = await makeEpisodeWithLegacyPathwayColumn();
    const pool = getDbPool();

    // A hibás (042P10 → '__legacy__') út lenyomata: NULL-source sorok a sablon
    // kódjaival, episode_pathways sor nélkül.
    for (let i = 0; i < TEMPLATE_CODES.length; i++) {
      await createTestWorkPhase(undefined, episodeId, {
        workPhaseCode: TEMPLATE_CODES[i],
        seq: i,
      });
    }

    const res = await callGenerate(episodeId, doctor);
    expect(res.status).toBe(200);
    expect((await res.json()).generated).toBe(false);

    // Nem duplikált; a bootstrap episode_pathways sor viszont létrejött.
    expect((await phaseRows(episodeId)).map((r) => r.work_phase_code)).toEqual(TEMPLATE_CODES);
    const epPathways = await pool.query(`SELECT id FROM episode_pathways WHERE episode_id = $1`, [
      episodeId,
    ]);
    expect(epPathways.rows).toHaveLength(1);

    // Review MAJOR 1: a MÁSODIK generate is idempotens. A bootstrap INSERT az
    // 1. hívásnál azonnal commitolt, így itt az epizódnak már van
    // episode_pathways sora — az őr nem támaszkodhat hívásonkénti memóriára
    // (bootstrappedPathwayIds), csak perzisztens adatra (NULL-source élő sorok
    // a sablon kódjaival), különben a sablon duplán szúródna be (3 → 6 sor).
    const res2 = await callGenerate(episodeId, doctor);
    expect(res2.status).toBe(200);
    expect((await res2.json()).generated).toBe(false);
    expect((await phaseRows(episodeId)).map((r) => r.work_phase_code)).toEqual(TEMPLATE_CODES);
  });

  it('review MAJOR 2: a legacy (NULL-source) terv törölt fázisai egyetlen generate-től sem élednek fel', async () => {
    const doctor = await makeDoctor();
    const { episodeId } = await makeEpisodeWithLegacyPathwayColumn();
    const pool = getDbPool();

    // A hibás '__legacy__' úton generált terv lenyomata: NULL-source sorok a
    // sablon kódjaival, episode_pathways sor nélkül.
    const legacyRows: Array<{ id: string }> = [];
    for (let i = 0; i < TEMPLATE_CODES.length; i++) {
      legacyRows.push(
        await createTestWorkPhase(undefined, episodeId, {
          workPhaseCode: TEMPLATE_CODES[i],
          seq: i,
        })
      );
    }

    // Az orvos MINDEN fázist töröl — a tombstone-ok source_episode_pathway_id-ja
    // NULL (a törölt sorok NULL-source-ok voltak).
    for (const row of legacyRows) {
      const delRes = await callDelete(episodeId, row.id, doctor);
      expect(delRes.status).toBe(200);
    }
    expect(await phaseRows(episodeId)).toHaveLength(0);

    const tombstones = await pool.query(
      `SELECT work_phase_code, source_episode_pathway_id FROM episode_work_phase_tombstones
        WHERE episode_id = $1 ORDER BY work_phase_code`,
      [episodeId]
    );
    expect(tombstones.rows).toHaveLength(3);
    for (const t of tombstones.rows) {
      expect(t.source_episode_pathway_id).toBeNull();
    }

    // Egyetlen generate sem támasztja fel a törölt tervet: a valós ági
    // tombstone-őrnek a NULL-source tombstone-okat is látnia kell
    // (episode_id + work_phase_code szerint), különben — mivel élő NULL-source
    // sor sincs — mindhárom fázis újra beszúródna.
    const res = await callGenerate(episodeId, doctor);
    expect(res.status).toBe(200);
    expect((await res.json()).generated).toBe(false);
    expect(await phaseRows(episodeId)).toHaveLength(0);
  });

  it('jogosultság: a generate technikusnak 403, a GET olvasásra mindenkinek szabad', async () => {
    const techUser = await createTestUser(undefined, { role: 'technikus' });
    const technician: TestAuthUser = { id: techUser.id, email: techUser.email, role: 'technikus' };
    const { episodeId } = await makeEpisodeWithLegacyPathwayColumn();

    const genRes = await callGenerate(episodeId, technician);
    expect(genRes.status).toBe(403);
    expect(await phaseRows(episodeId)).toHaveLength(0);

    const getRes = await callGet(episodeId, technician);
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).workPhases).toEqual([]);
  });
});
