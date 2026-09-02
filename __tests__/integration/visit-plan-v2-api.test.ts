/**
 * Puzzle v2 — vizit-alapú terv szerver-oldala (valódi DB):
 *  - POST /work-phases `visitId`-vel a MEGLÉVŐ alkalomba szúr (egy kérés), a
 *    fázis-seq az alkalom-sorrendet követi; `visitId` nélkül új alkalom,
 *    vizitköz = 7 nap; a 091-es paletta-alapértékek (időtartam, pool) töltik
 *    a meg nem adott mezőket;
 *  - POST /visits daysOffset nélkül → 7 nap;
 *  - PATCH visitId egy összevont GYEREKEN: kilép a csoportból és önállóan
 *    költözik (a csoport nem hasad két vizitre);
 *  - POST /visits/:id/prepare-booking: az alkalom nyitott fázisai egy
 *    blokkba (merge), a primary perce a tagok összege, idempotens;
 *  - a slot-intent projektor vizit-tudatos: egy alkalom fázisai közös
 *    javasolt kezdést kapnak, a következő alkalom a vizitköz után.
 *
 * Route-handlereket hívunk → pool + afterEach takarítás (docs/INTEGRATION_TESTS.md).
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
import {
  cleanupCreatedWp03,
  createTestCarePathway,
  createTestTreatmentType,
} from './helpers/factories-wp03';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { POST as workPhasePost } from '@/app/api/episodes/[id]/work-phases/route';
import { PATCH as workPhasePatch } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';
import { POST as visitPost } from '@/app/api/episodes/[id]/visits/route';
import { POST as prepareBookingPost } from '@/app/api/episodes/[id]/visits/[visitId]/prepare-booking/route';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { DEFAULT_VISIT_GAP_DAYS } from '@/lib/visit-plan-constants';

afterEach(async () => {
  await cleanupCreatedWp41a();
  await cleanupCreated();
  await cleanupCreatedWp03();
});

async function authUser(): Promise<TestAuthUser> {
  const u = await createTestUser();
  return { id: u.id, email: u.email, role: 'fogpótlástanász' };
}

async function createVisit(episodeId: string, seq: number, daysOffset: number | null) {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `INSERT INTO episode_visits (episode_id, seq, days_offset) VALUES ($1, $2, $3) RETURNING id`,
    [episodeId, seq, daysOffset]
  );
  return rows[0].id as string;
}

async function phaseRows(episodeId: string) {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT e.id, e.work_phase_code, e.seq, e.visit_id, e.duration_minutes, e.pool,
            e.merged_into_episode_work_phase_id AS merged_into, v.seq AS visit_seq
     FROM episode_work_phases e LEFT JOIN episode_visits v ON v.id = e.visit_id
     WHERE e.episode_id = $1
     ORDER BY COALESCE(e.seq, e.pathway_order_index), e.pathway_order_index`,
    [episodeId]
  );
  return rows as Array<{
    id: string; work_phase_code: string; seq: number | null; visit_id: string | null;
    duration_minutes: number; pool: string; merged_into: string | null; visit_seq: number | null;
  }>;
}

describe('Puzzle v2 — POST /work-phases visitId + paletta-alapértékek', () => {
  it('visitId-vel a meglévő alkalomba szúr (nincs új vizit), a seq az alkalom-sorrendet követi', async () => {
    const pool = getDbPool();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0, 7);
    const v2 = await createVisit(episode.id, 1, 14);
    await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'a', seq: 0, visitId: v1 });
    await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'b', seq: 1, visitId: v2 });
    const user = await authUser();

    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/work-phases`, {
      user,
      method: 'POST',
      body: { workPhaseCode: 'gen_csonkpreparalas', visitId: v1 },
    });
    const res = await workPhasePost(req, { params: { id: episode.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.visit).toBeNull();
    expect(body.workPhase.visitId).toBe(v1);
    // 091 paletta-alapértékek: Csonkpreparálás 60 perc, work pool
    expect(body.workPhase.durationMinutes).toBe(60);
    expect(body.workPhase.pool).toBe('work');

    const visits = await pool.query(`SELECT id FROM episode_visits WHERE episode_id = $1`, [episode.id]);
    expect(visits.rows).toHaveLength(2);

    // Sorrend: v1 tagjai (a, ÚJ) → v2 tagja (b); az új sor az alkalmán belül utolsó
    const rows = await phaseRows(episode.id);
    expect(rows.map((r) => r.work_phase_code)).toEqual(['a', 'gen_csonkpreparalas', 'b']);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
  });

  it('visitId nélkül új alkalom nyílik a lista végére, vizitköz = 7 nap', async () => {
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    await createVisit(episode.id, 0, 7);
    const user = await authUser();

    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/work-phases`, {
      user,
      method: 'POST',
      body: { label: 'Ideiglenes korona' },
    });
    const res = await workPhasePost(req, { params: { id: episode.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.visit).toBeTruthy();
    expect(body.visit.seq).toBe(1);
    expect(body.visit.daysOffset).toBe(DEFAULT_VISIT_GAP_DAYS);
    expect(body.workPhase.visitId).toBe(body.visit.id);
    expect(body.workPhase.customLabel).toBe('Ideiglenes korona');
  });

  it('ismeretlen visitId → 404 VISIT_NOT_FOUND, nem születik fázis', async () => {
    const pool = getDbPool();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const user = await authUser();
    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/work-phases`, {
      user,
      method: 'POST',
      body: { workPhaseCode: 'gen_atadas', visitId: '00000000-0000-0000-0000-000000000000' },
    });
    const res = await workPhasePost(req, { params: { id: episode.id } });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('VISIT_NOT_FOUND');
    const rows = await pool.query(`SELECT 1 FROM episode_work_phases WHERE episode_id = $1`, [episode.id]);
    expect(rows.rows).toHaveLength(0);
  });
});

describe('Puzzle v2 — POST /visits alapértelmezett vizitköz', () => {
  it('daysOffset nélkül 7 napos lépésközzel születik az alkalom', async () => {
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const user = await authUser();
    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits`, {
      user,
      method: 'POST',
      body: {},
    });
    const res = await visitPost(req, { params: { id: episode.id } });
    expect(res.status).toBe(201);
    const pool = getDbPool();
    const { rows } = await pool.query(`SELECT days_offset FROM episode_visits WHERE episode_id = $1`, [episode.id]);
    expect(rows[0].days_offset).toBe(DEFAULT_VISIT_GAP_DAYS);
  });
});

describe('Puzzle v2 — összevont gyerek áthelyezése', () => {
  it('a gyerek kilép a csoportból és önállóan költözik; a primary marad', async () => {
    const pool = getDbPool();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0, 7);
    const v2 = await createVisit(episode.id, 1, 7);
    const primary = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'p', seq: 0, visitId: v1 });
    const child = await createWp41aWorkPhase(undefined, episode.id, {
      workPhaseCode: 'c', seq: 1, visitId: v1, mergedInto: primary.id,
    });
    await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'x', seq: 2, visitId: v2 });
    const user = await authUser();

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${child.id}`,
      { user, method: 'PATCH', body: { visitId: v2 } }
    );
    const res = await workPhasePatch(req, { params: { id: episode.id, workPhaseId: child.id } });
    expect(res.status).toBe(200);

    const rows = await phaseRows(episode.id);
    const byCode = new Map(rows.map((r) => [r.work_phase_code, r]));
    expect(byCode.get('c')?.visit_id).toBe(v2);
    expect(byCode.get('c')?.merged_into).toBeNull();
    expect(byCode.get('p')?.visit_id).toBe(v1);
    // Az áthelyezett sor a cél-alkalom VÉGÉRE kerül: p (v1) → x, c (v2)
    expect(rows.map((r) => r.work_phase_code)).toEqual(['p', 'x', 'c']);

    const audit = await pool.query(
      `SELECT change_type FROM episode_work_phase_audit
       WHERE episode_work_phase_id = $1 ORDER BY created_at`,
      [child.id]
    );
    expect(audit.rows.map((r: { change_type: string }) => r.change_type)).toEqual(
      expect.arrayContaining(['unmerge', 'visit_change'])
    );
  });
});

describe('Puzzle v2 — prepare-booking (egy alkalom = egy időpont)', () => {
  it('a nyitott fázisokat a sorrendben első alá vonja, a perc összeadódik; második hívás no-op', async () => {
    const pool = getDbPool();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0, 7);
    const a = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'csonk', seq: 0, visitId: v1, durationMinutes: 30 });
    const b = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'lenyomat', seq: 1, visitId: v1, durationMinutes: 15 });
    const c = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'harapas', seq: 2, visitId: v1, durationMinutes: 45 });
    await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'kesz', seq: 3, visitId: v1, status: 'skipped' });
    const user = await authUser();

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/prepare-booking`,
      { user, method: 'POST' }
    );
    const res = await prepareBookingPost(req, { params: { id: episode.id, visitId: v1 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.primaryWorkPhaseId).toBe(a.id);
    expect(body.mergedCount).toBe(2);
    expect(body.durationMinutes).toBe(90);

    const rows = await phaseRows(episode.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a.id)?.merged_into).toBeNull();
    expect(byId.get(a.id)?.duration_minutes).toBe(90);
    expect(byId.get(b.id)?.merged_into).toBe(a.id);
    expect(byId.get(c.id)?.merged_into).toBe(a.id);

    // Idempotens: nincs több beolvasztandó, a perc marad
    const req2 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/prepare-booking`,
      { user, method: 'POST' }
    );
    const res2 = await prepareBookingPost(req2, { params: { id: episode.id, visitId: v1 } });
    const body2 = await res2.json();
    expect(body2.mergedCount).toBe(0);
    expect(body2.durationMinutes).toBe(90);
    expect(body2.primaryWorkPhaseId).toBe(a.id);

    const audit = await pool.query(
      `SELECT change_type, COUNT(*)::int AS c FROM episode_work_phase_audit
       WHERE episode_id = $1 GROUP BY change_type`,
      [episode.id]
    );
    const counts = new Map(audit.rows.map((r: { change_type: string; c: number }) => [r.change_type, r.c]));
    expect(counts.get('merge')).toBe(2);
    expect(counts.get('timing_change')).toBe(1);
  });

  it('csak lezárt fázisú alkalom → 409 VISIT_NOT_BOOKABLE', async () => {
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0, 7);
    await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'x', seq: 0, visitId: v1, status: 'completed' });
    const user = await authUser();
    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/prepare-booking`,
      { user, method: 'POST' }
    );
    const res = await prepareBookingPost(req, { params: { id: episode.id, visitId: v1 } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('VISIT_NOT_BOOKABLE');
  });
});

describe('Puzzle v2 — vizit-tudatos slot-intent projektor', () => {
  it('egy alkalom fázisai közös javasolt kezdést kapnak, a következő alkalom a vizitköz után', async () => {
    const pool = getDbPool();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const tt = await createTestTreatmentType(undefined);
    const cp = await createTestCarePathway(undefined, tt.id);
    await pool.query(`UPDATE care_pathways SET work_phases_json = $1::jsonb WHERE id = $2`, [
      JSON.stringify([
        { work_phase_code: 'csonk', default_days_offset: 7, duration_minutes: 30, pool: 'work' },
        { work_phase_code: 'lenyomat', default_days_offset: 7, duration_minutes: 30, pool: 'work' },
        { work_phase_code: 'atadas', default_days_offset: 7, duration_minutes: 30, pool: 'work' },
      ]),
      cp.id,
    ]);
    await pool.query(`UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`, [cp.id, episode.id]);
    const v1 = await createVisit(episode.id, 0, 7);
    const v2 = await createVisit(episode.id, 1, 14);
    // A fázisok SAJÁT offsetje szándékosan eltérő — nem szabad számítania.
    const p1 = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'csonk', seq: 0, visitId: v1, defaultDaysOffset: 3 });
    const p2 = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'lenyomat', seq: 1, visitId: v1, defaultDaysOffset: 21 });
    const p3 = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'atadas', seq: 2, visitId: v2, defaultDaysOffset: 2 });

    const result = await projectRemainingSteps(episode.id);
    expect(result.projected).toBe(3);

    const { rows } = await pool.query(
      `SELECT work_phase_id, suggested_start FROM slot_intents
       WHERE episode_id = $1 AND state = 'open'`,
      [episode.id]
    );
    const byWp = new Map(rows.map((r: { work_phase_id: string; suggested_start: Date }) => [r.work_phase_id, new Date(r.suggested_start)]));
    const s1 = byWp.get(p1.id) as Date;
    const s2 = byWp.get(p2.id) as Date;
    const s3 = byWp.get(p3.id) as Date;
    expect(s1.getTime()).toBe(s2.getTime());
    const dayDiff = Math.round((s3.getTime() - s1.getTime()) / 86400000);
    expect(dayDiff).toBe(14);
  });
});
