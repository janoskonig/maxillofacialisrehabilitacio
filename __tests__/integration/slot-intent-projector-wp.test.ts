/**
 * WP-4.2 — a projektor work_phase_id-tudatos: kitölti a slot_intents
 * work_phase_id-jét (a 025-ös migráció eredeti szándéka), a lefedettség és a
 * stale-lejáratás wp-elsődleges — duplikált work_phase_code-nál az egyik
 * testvér állapota nem nyomja el / járatja le a másik testvér intentjét.
 *
 * Route-ot nem hívunk; a projektor maga COMMIT-ol, ezért a factory-k pool-lal
 * futnak és afterEach-ben takarítunk (az epizód-törlés kaszkádol az
 * intentekre és a fázisokra).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestWorkPhase,
} from './helpers/factories';
import {
  cleanupCreatedWp03,
  createTestCarePathway,
  createTestTreatmentType,
} from './helpers/factories-wp03';

afterEach(async () => {
  // Előbb az epizód/beteg sorok (kaszkádol az EWP-kre és intentekre), csak
  // utána a sablon — a patient_episodes.care_pathway_id FK miatt.
  await cleanupCreated();
  await cleanupCreatedWp03();
});

async function twoSameCodePhases() {
  const pool = getDbPool();
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  // A projektor pathway nélkül NO_PATHWAY-jel kilép — kell egy sablon, amiben
  // a 'lenyomat' szerepel (a pool/duration feloldásához is).
  const tt = await createTestTreatmentType(undefined);
  const cp = await createTestCarePathway(undefined, tt.id);
  await pool.query(`UPDATE care_pathways SET work_phases_json = $1::jsonb WHERE id = $2`, [
    JSON.stringify([
      { work_phase_code: 'lenyomat', default_days_offset: 7, duration_minutes: 30, pool: 'work' },
    ]),
    cp.id,
  ]);
  await pool.query(`UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`, [
    cp.id,
    episode.id,
  ]);
  const ewpA = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    seq: 0,
    pathwayOrderIndex: 0,
  });
  const ewpB = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    seq: 1,
    pathwayOrderIndex: 1,
  });
  return { pool, episode, ewpA, ewpB };
}

async function openIntents(pool: ReturnType<typeof getDbPool>, episodeId: string) {
  const { rows } = await pool.query(
    `SELECT id, step_code, step_seq, state, work_phase_id
     FROM slot_intents WHERE episode_id = $1 ORDER BY step_seq`,
    [episodeId]
  );
  return rows as Array<{
    id: string;
    step_code: string;
    step_seq: number;
    state: string;
    work_phase_id: string | null;
  }>;
}

describe('WP-4.2 — projektor work_phase_id-kitöltés és sor-szintű lefedettség', () => {
  it('a generált intentek work_phase_id-t kapnak (duplikált kódnál is, sorra pontosan)', async () => {
    const { pool, episode, ewpA, ewpB } = await twoSameCodePhases();

    const result = await projectRemainingSteps(episode.id);
    expect(result.projected).toBe(2);

    const intents = await openIntents(pool, episode.id);
    const open = intents.filter((i) => i.state === 'open');
    expect(open).toHaveLength(2);
    expect(open.find((i) => i.step_seq === 0)?.work_phase_id).toBe(ewpA.id);
    expect(open.find((i) => i.step_seq === 1)?.work_phase_id).toBe(ewpB.id);
  });

  it('az egyik testvér teljesítése CSAK a saját intentjét járatja le', async () => {
    const { pool, episode, ewpA, ewpB } = await twoSameCodePhases();
    await projectRemainingSteps(episode.id);

    await pool.query(
      `UPDATE episode_work_phases SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [ewpA.id]
    );
    await projectRemainingSteps(episode.id);

    const intents = await openIntents(pool, episode.id);
    const forA = intents.find((i) => i.work_phase_id === ewpA.id);
    const forB = intents.find((i) => i.work_phase_id === ewpB.id);
    expect(forA?.state).toBe('expired');
    expect(forB?.state).toBe('open');
  });

  it('seq-átrendezés után a wp-hez kötött intent új kulcson nyílik újra (nincs 23505)', async () => {
    const { pool, episode, ewpB } = await twoSameCodePhases();
    await projectRemainingSteps(episode.id);

    // A B fázis a lista elejére kerül (seq-csere a valós reorder mintájára).
    await pool.query(`UPDATE episode_work_phases SET seq = 5 WHERE id = $1`, [ewpB.id]);

    // Az újravetítés nem dobhat unique-hibát (idx_slot_intents_unique_open_work_phase):
    // a régi kulcsú nyitott sor előbb lejár, az új kulcsú kapja a wp-linket.
    await projectRemainingSteps(episode.id);

    const intents = await openIntents(pool, episode.id);
    const openForB = intents.filter((i) => i.work_phase_id === ewpB.id && i.state === 'open');
    expect(openForB).toHaveLength(1);
    expect(openForB[0].step_seq).toBe(5);
  });
});
