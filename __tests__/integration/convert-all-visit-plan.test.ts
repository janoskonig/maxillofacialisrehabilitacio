/**
 * „Összes időpont lefoglalása" a puzzle-táblán (WP-6.x) — a sablon nélküli terv.
 *
 * A tábla a palettából épül (POST /work-phases → új alkalom), a betegnek
 * gyakran NINCS kezelési sablonja (care_pathway). A gomb a
 * POST /api/episodes/:id/convert-all-intents útra megy, amely előbb a
 * projektort futtatja: a projektor sablon nélkül `NO_PATHWAY`-jel kilépett,
 * intent nem született, a köteg „0 időpont lefoglalva" lett — a gomb
 * látszólag nem csinált semmit. A javítás után az episode_work_phases az
 * igazság: sablon nélkül is vetít, a köteg lefoglal, és a lépésköz a tábla
 * vizitköze (episode_visits.days_offset), nem a fázis legacy offsetje.
 *
 * Route-handlereket hívunk, ezért a factory-k pool-lal (db nélkül) futnak és
 * afterEach-ben takarítunk (docs/INTEGRATION_TESTS.md, 2. minta).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestSlot,
  createTestUser,
} from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { POST as workPhasePost } from '@/app/api/episodes/[id]/work-phases/route';
import { POST as convertAllPost } from '@/app/api/episodes/[id]/convert-all-intents/route';
import { POST as prepareBookingPost } from '@/app/api/episodes/[id]/visits/[visitId]/prepare-booking/route';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const createdEpisodeIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  if (createdEpisodeIds.length > 0) {
    await pool.query(`DELETE FROM appointments WHERE episode_id = ANY($1::uuid[])`, [createdEpisodeIds]);
    await pool.query(`DELETE FROM scheduling_events WHERE entity_id = ANY($1::uuid[])`, [createdEpisodeIds]);
    createdEpisodeIds.length = 0;
  }
  await cleanupCreated();
});

async function setup(): Promise<{ user: TestAuthUser; episodeId: string; patientId: string }> {
  const pool = getDbPool();
  const u = await createTestUser(undefined, { role: 'admin', doktorNeve: 'Dr. Köteg' });
  const user: TestAuthUser = { id: u.id, email: u.email, role: 'admin' };
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  createdEpisodeIds.push(episode.id);
  // A kijelölt orvos rögzítése: a köteg csak az itt létrehozott slotok közül választ.
  await pool.query(`UPDATE patient_episodes SET assigned_provider_id = $1 WHERE id = $2`, [u.id, episode.id]);
  return { user, episodeId: episode.id, patientId: patient.id };
}

async function addPhase(
  user: TestAuthUser,
  episodeId: string,
  body: Record<string, unknown>
): Promise<{ phaseId: string; visitId: string }> {
  const req = await authedRequest(`http://test.local/api/episodes/${episodeId}/work-phases`, {
    user,
    method: 'POST',
    body,
  });
  const res = await workPhasePost(req, { params: { id: episodeId } });
  expect(res.status).toBe(201);
  const json = await res.json();
  return { phaseId: String(json.workPhase.id), visitId: String(json.workPhase.visitId) };
}

async function convertAll(user: TestAuthUser, episodeId: string) {
  const req = await authedRequest(`http://test.local/api/episodes/${episodeId}/convert-all-intents`, {
    user,
    method: 'POST',
  });
  const res = await convertAllPost(req, { params: { id: episodeId } });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    converted: number;
    appointmentIds: string[];
    skipped: Array<{ intentId: string; reason: string; code?: string; stepCode?: string }>;
  };
}

async function appointmentStart(appointmentId: string): Promise<Date> {
  const { rows } = await getDbPool().query(`SELECT start_time FROM appointments WHERE id = $1`, [appointmentId]);
  return new Date(rows[0].start_time);
}

describe('Összes időpont lefoglalása — sablon nélküli (palettából épített) terv', () => {
  it('a projektor sablon nélkül is vetíti az alkalmakat; a pool a fázis sorából jön', async () => {
    const pool = getDbPool();
    const { user, episodeId } = await setup();
    const konz = await addPhase(user, episodeId, { label: 'Konzultáció', pool: 'consult', durationMinutes: 20 });
    const csonk = await addPhase(user, episodeId, { workPhaseCode: 'gen_csonkpreparalas' });

    const result = await projectRemainingSteps(episodeId);
    expect(result.reason).toBeUndefined();
    expect(result.projected).toBe(2);

    const intents = await pool.query(
      `SELECT state, work_phase_id, pool, source_pathway_hash
       FROM slot_intents WHERE episode_id = $1 ORDER BY step_seq`,
      [episodeId]
    );
    expect(intents.rows).toHaveLength(2);
    expect(intents.rows.every((r) => r.state === 'open')).toBe(true);
    expect(intents.rows.map((r) => r.work_phase_id)).toEqual([konz.phaseId, csonk.phaseId]);
    expect(intents.rows.map((r) => r.pool)).toEqual(['consult', 'work']);
    // Sablon nélkül nincs hash — a második futás nem járatja le az intenteket.
    expect(intents.rows.every((r) => r.source_pathway_hash === null)).toBe(true);
    const again = await projectRemainingSteps(episodeId);
    expect(again.projected).toBe(2);
    const stillOpen = await pool.query(
      `SELECT COUNT(*)::int AS c FROM slot_intents WHERE episode_id = $1 AND state = 'open'`,
      [episodeId]
    );
    expect(stillOpen.rows[0].c).toBe(2);
  });

  it('két alkalom, sablon nélkül → két időpont, mindkét alkalom foglalt', async () => {
    const pool = getDbPool();
    const { user, episodeId } = await setup();
    const a = await addPhase(user, episodeId, { workPhaseCode: 'gen_csonkpreparalas' });
    const b = await addPhase(user, episodeId, { workPhaseCode: 'gen_lenyomatvetel' });
    expect(a.visitId).not.toBe(b.visitId);

    // A vizitköz alapból 7 nap: +2 és +10 napra egy-egy szabad slot (a paletta
    // fogelőkészítése 60 perces — a slot legyen elég hosszú).
    await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 2 * MS_PER_DAY), durationMinutes: 90 });
    await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 10 * MS_PER_DAY), durationMinutes: 90 });

    const body = await convertAll(user, episodeId);
    expect(body.skipped).toEqual([]);
    expect(body.converted).toBe(2);

    for (const { phaseId, visitId } of [a, b]) {
      const ph = await pool.query(`SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`, [phaseId]);
      expect(ph.rows[0].status).toBe('scheduled');
      expect(ph.rows[0].appointment_id).toBeTruthy();
      const v = await pool.query(`SELECT appointment_id FROM episode_visits WHERE id = $1`, [visitId]);
      expect(v.rows[0].appointment_id).toBe(ph.rows[0].appointment_id);
    }
  });

  it('több-fázisú alkalom: prepare-booking után egy alkalom = egy időpont', async () => {
    const pool = getDbPool();
    const { user, episodeId } = await setup();
    const first = await addPhase(user, episodeId, { workPhaseCode: 'gen_csonkpreparalas' });
    const second = await addPhase(user, episodeId, { workPhaseCode: 'gen_lenyomatvetel', visitId: first.visitId });
    const third = await addPhase(user, episodeId, { workPhaseCode: 'gen_atadas' });

    // A kliens (handleConvertAll) a több-fázisú alkalmat előbb blokkba vonja.
    const prepReq = await authedRequest(
      `http://test.local/api/episodes/${episodeId}/visits/${first.visitId}/prepare-booking`,
      { user, method: 'POST' }
    );
    const prepRes = await prepareBookingPost(prepReq, { params: { id: episodeId, visitId: first.visitId } });
    expect(prepRes.status).toBe(200);
    expect((await prepRes.json()).primaryWorkPhaseId).toBe(first.phaseId);

    await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 2 * MS_PER_DAY), durationMinutes: 120 });
    await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 10 * MS_PER_DAY), durationMinutes: 120 });

    const body = await convertAll(user, episodeId);
    expect(body.skipped).toEqual([]);
    expect(body.converted).toBe(2);

    const v1 = await pool.query(`SELECT appointment_id FROM episode_visits WHERE id = $1`, [first.visitId]);
    expect(v1.rows[0].appointment_id).toBeTruthy();
    const primary = await pool.query(`SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`, [first.phaseId]);
    expect(primary.rows[0].status).toBe('scheduled');
    expect(primary.rows[0].appointment_id).toBe(v1.rows[0].appointment_id);
    const child = await pool.query(
      `SELECT merged_into_episode_work_phase_id AS merged_into, appointment_id FROM episode_work_phases WHERE id = $1`,
      [second.phaseId]
    );
    expect(child.rows[0].merged_into).toBe(first.phaseId);
    const v2 = await pool.query(`SELECT appointment_id FROM episode_visits WHERE id = $1`, [third.visitId]);
    expect(v2.rows[0].appointment_id).toBeTruthy();
    expect(v2.rows[0].appointment_id).not.toBe(v1.rows[0].appointment_id);
  });

  it('a lépésköz a tábla vizitköze (episode_visits.days_offset), nem a fázis legacy offsetje', async () => {
    const pool = getDbPool();
    const { user, episodeId } = await setup();
    const a = await addPhase(user, episodeId, { workPhaseCode: 'gen_csonkpreparalas' });
    const b = await addPhase(user, episodeId, { workPhaseCode: 'gen_lenyomatvetel' });
    // A tábláról a 2. alkalom vizitköze 14 napra nő; a fázis default_days_offset-je
    // (a létrehozáskori 7 nap) nem követi — a köteg a vizitközön kell járjon.
    await pool.query(`UPDATE episode_visits SET days_offset = 14 WHERE id = $1`, [b.visitId]);

    await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 2 * MS_PER_DAY), durationMinutes: 90 });
    const tooEarly = await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 9 * MS_PER_DAY), durationMinutes: 90 });
    const spaced = await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 17 * MS_PER_DAY), durationMinutes: 90 });

    const body = await convertAll(user, episodeId);
    expect(body.skipped).toEqual([]);
    expect(body.converted).toBe(2);

    const bPhase = await pool.query(`SELECT appointment_id FROM episode_work_phases WHERE id = $1`, [b.phaseId]);
    const bAppt = await pool.query(`SELECT time_slot_id FROM appointments WHERE id = $1`, [bPhase.rows[0].appointment_id]);
    expect(bAppt.rows[0].time_slot_id).toBe(spaced.id);
    expect(bAppt.rows[0].time_slot_id).not.toBe(tooEarly.id);

    const aPhase = await pool.query(`SELECT appointment_id FROM episode_work_phases WHERE id = $1`, [a.phaseId]);
    const gapDays =
      ((await appointmentStart(bPhase.rows[0].appointment_id)).getTime() -
        (await appointmentStart(aPhase.rows[0].appointment_id)).getTime()) /
      MS_PER_DAY;
    expect(gapDays).toBeGreaterThanOrEqual(14);
  });
});
