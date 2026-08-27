import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { GET as getWorkPhases } from '@/app/api/episodes/[id]/work-phases/route';
import { GET as adminScan } from '@/app/api/admin/scheduling-integrity/route';
import { authedRequest } from './helpers/auth';
import {
  cleanupCreated,
  createTestAppointment,
  createTestEpisode,
  createTestPatient,
  createTestSlot,
  createTestUser,
  createTestWorkPhase,
} from './helpers/factories';

/**
 * WP-1.2 — az integritás-javítás automatikus és IDEMPOTENT.
 *
 * Viselkedési teszt: a terv-kártya olvasó útja (GET work-phases) és az
 * admin-scan (GET /api/admin/scheduling-integrity) magától rendbe teszi a
 * javítható violationöket (stale foglalás-link, step_code eltérés), kérdezés
 * nélkül. Kétszer futtatva ugyanaz az állapot: a második futás nem javít
 * semmit, és nem duplikálja az audit-bejegyzést.
 *
 * A route-ok saját kapcsolaton COMMIT-olnak, ezért a factory-k pool-lal
 * futnak és afterEach-ben takarítunk (cleanupCreated + kézi FK-sorrend).
 */

const createdEpisodeIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  for (const episodeId of createdEpisodeIds) {
    await pool.query(
      `UPDATE episode_work_phases SET appointment_id = NULL WHERE episode_id = $1`,
      [episodeId]
    );
    await pool.query(`DELETE FROM appointments WHERE episode_id = $1`, [episodeId]);
    await pool.query(`DELETE FROM slot_intents WHERE episode_id = $1`, [episodeId]);
    await pool
      .query(`DELETE FROM scheduling_events WHERE entity_id = $1`, [episodeId])
      .catch(() => {});
    await pool
      .query(`DELETE FROM episode_work_phase_audit WHERE episode_id = $1`, [episodeId])
      .catch(() => {});
  }
  createdEpisodeIds.length = 0;
  await cleanupCreated();
});

/** scheduled fázis, amelynek a linkelt foglalása már lemondott (dangling). */
async function setupDanglingLink() {
  const pool = getDbPool();
  const user = await createTestUser();
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  createdEpisodeIds.push(episode.id);

  const wp = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    status: 'scheduled',
    seq: 0,
  });
  const slot = await createTestSlot(undefined, user.id, {
    state: 'free',
    status: 'available',
  });
  const appt = await createTestAppointment(undefined, {
    patientId: patient.id,
    timeSlotId: slot.id,
    episodeId: episode.id,
    workPhaseId: wp.id,
    stepCode: 'lenyomat',
    stepSeq: 0,
    appointmentStatus: 'cancelled_by_doctor',
  });
  // A dangling állapot: az EWP a lemondott foglalásra mutat.
  await pool.query(
    `UPDATE episode_work_phases SET appointment_id = $1 WHERE id = $2`,
    [appt.id, wp.id]
  );

  return { user, patient, episode, wp, appt };
}

/** scheduled fázis AKTÍV foglalással, de eltérő step_code/step_seq snapshottal. */
async function setupStepMismatch() {
  const pool = getDbPool();
  const user = await createTestUser();
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  createdEpisodeIds.push(episode.id);

  const wp = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    status: 'scheduled',
    seq: 0,
    pathwayOrderIndex: 0,
  });
  const slot = await createTestSlot(undefined, user.id, {
    state: 'booked',
    status: 'booked',
  });
  const appt = await createTestAppointment(undefined, {
    patientId: patient.id,
    timeSlotId: slot.id,
    episodeId: episode.id,
    workPhaseId: wp.id,
    stepCode: 'koronaproba', // ≠ ewp.work_phase_code
    stepSeq: 3, // ≠ ewp.pathway_order_index
    appointmentStatus: null, // aktív
  });
  await pool.query(
    `UPDATE episode_work_phases SET appointment_id = $1 WHERE id = $2`,
    [appt.id, wp.id]
  );

  return { user, patient, episode, wp, appt };
}

async function callWorkPhasesGet(
  user: { id: string; email: string },
  episodeId: string
) {
  const req = await authedRequest(
    `http://test.local/api/episodes/${episodeId}/work-phases`,
    { user: { id: user.id, email: user.email, role: 'fogpótlástanász' } }
  );
  return getWorkPhases(req, { params: { id: episodeId } });
}

async function auditCount(episodeId: string): Promise<number> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c FROM episode_work_phase_audit WHERE episode_id = $1`,
    [episodeId]
  );
  return res.rows[0].c;
}

describe('WP-1.2: auto-repair a terv-kártya olvasásakor (GET work-phases)', () => {
  it('dangling link: első olvasás javít + auditál, második olvasás nem csinál semmit (idempotens)', async () => {
    const pool = getDbPool();
    const { user, episode, wp, appt } = await setupDanglingLink();

    // 1. olvasás — auto-repair takarít
    const res1 = await callWorkPhasesGet(user, episode.id);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.autoRepair).toEqual({ danglingCleared: 1, mismatchRepaired: 0 });

    const ewpRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [wp.id]
    );
    expect(ewpRow.rows[0].status).toBe('pending');
    expect(ewpRow.rows[0].appointment_id).toBeNull();

    // A foglaláshoz és a slothoz nem nyúlt
    const apptRow = await pool.query(
      `SELECT appointment_status FROM appointments WHERE id = $1`,
      [appt.id]
    );
    expect(apptRow.rows[0].appointment_status).toBe('cancelled_by_doctor');

    // Audit-bejegyzés a takarításról
    const audit1 = await pool.query(
      `SELECT old_status, new_status, reason FROM episode_work_phase_audit
       WHERE episode_id = $1 AND episode_work_phase_id = $2`,
      [episode.id, wp.id]
    );
    expect(audit1.rows).toHaveLength(1);
    expect(audit1.rows[0].old_status).toBe('scheduled');
    expect(audit1.rows[0].new_status).toBe('pending');
    expect(audit1.rows[0].reason).toContain(
      'integrity repair: dangling appointment_id takarítása'
    );
    expect(audit1.rows[0].reason).toContain('automatikus javítás');

    // A sor-szintű karton-jelzéshez az id visszajön
    expect(body1.lostAppointmentWorkPhaseIds).toContain(wp.id);

    // 2. olvasás — nincs mit javítani, nincs új audit
    const countBefore = await auditCount(episode.id);
    const res2 = await callWorkPhasesGet(user, episode.id);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.autoRepair).toEqual({ danglingCleared: 0, mismatchRepaired: 0 });
    expect(await auditCount(episode.id)).toBe(countBefore);

    // A jelzés a javítás után is megmarad, amíg nincs új foglalás
    expect(body2.lostAppointmentWorkPhaseIds).toContain(wp.id);

    // A workPhases lista a javított állapotot mutatja
    const row = (body2.workPhases as Array<{ id: string; status: string }>).find(
      (r) => r.id === wp.id
    );
    expect(row?.status).toBe('pending');
  });

  it('step mismatch: a snapshot az EWP-hez igazodik, a foglalás állapota nem változik; a második futás üres', async () => {
    const pool = getDbPool();
    const { user, episode, wp, appt } = await setupStepMismatch();

    const res1 = await callWorkPhasesGet(user, episode.id);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.autoRepair).toEqual({ danglingCleared: 0, mismatchRepaired: 1 });

    const apptRow = await pool.query(
      `SELECT step_code, step_seq, work_phase_id, appointment_status
       FROM appointments WHERE id = $1`,
      [appt.id]
    );
    expect(apptRow.rows[0].step_code).toBe('lenyomat');
    expect(apptRow.rows[0].step_seq).toBe(0);
    expect(apptRow.rows[0].work_phase_id).toBe(wp.id);
    expect(apptRow.rows[0].appointment_status).toBeNull();

    // Az EWP link és státusz érintetlen (aktív foglalás → marad scheduled)
    const ewpRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [wp.id]
    );
    expect(ewpRow.rows[0].status).toBe('scheduled');
    expect(ewpRow.rows[0].appointment_id).toBe(appt.id);

    // Mismatch-javítás nem termel lostAppointment-jelzést
    expect(body1.lostAppointmentWorkPhaseIds).not.toContain(wp.id);

    // Idempotencia: második futás nem talál javítanivalót
    const res2 = await callWorkPhasesGet(user, episode.id);
    const body2 = await res2.json();
    expect(body2.autoRepair).toEqual({ danglingCleared: 0, mismatchRepaired: 0 });
  });
});

describe('WP-1.2: admin-scan auto-repair (GET /api/admin/scheduling-integrity)', () => {
  it('a scan magától javítja a javíthatót, és a maradék-listában már nem szerepel; kétszer futtatva idempotens', async () => {
    const pool = getDbPool();
    const { episode, wp } = await setupDanglingLink();
    const admin = await createTestUser(undefined, { role: 'admin' });

    const req1 = await authedRequest(
      'http://test.local/api/admin/scheduling-integrity',
      { user: { id: admin.id, email: admin.email, role: 'admin' } }
    );
    const res1 = await adminScan(req1, { params: {} });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // A javítás megtörtént (legalább a mi epizódunk danglingje)
    expect(body1.autoRepair.danglingCleared).toBeGreaterThanOrEqual(1);
    const ewpRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [wp.id]
    );
    expect(ewpRow.rows[0].status).toBe('pending');
    expect(ewpRow.rows[0].appointment_id).toBeNull();

    // A maradék-listában a mi epizódunk nem szerepel javítható violationnel
    const ourEpisode = (body1.episodes as Array<{
      episodeId: string;
      violations: Array<{ repairable?: boolean }>;
    }>).find((e) => e.episodeId === episode.id);
    expect(ourEpisode?.violations.some((v) => v.repairable) ?? false).toBe(false);

    // Második scan: a mi epizódunkon már nincs mit javítani, nincs új audit
    const countBefore = await auditCount(episode.id);
    const req2 = await authedRequest(
      'http://test.local/api/admin/scheduling-integrity',
      { user: { id: admin.id, email: admin.email, role: 'admin' } }
    );
    const res2 = await adminScan(req2, { params: {} });
    expect(res2.status).toBe(200);
    expect(await auditCount(episode.id)).toBe(countBefore);
  });

  it('technikus nem futtathatja a scant (403)', async () => {
    const tech = await createTestUser(undefined, { role: 'technikus' });
    const req = await authedRequest(
      'http://test.local/api/admin/scheduling-integrity',
      { user: { id: tech.id, email: tech.email, role: 'technikus' } }
    );
    const res = await adminScan(req, { params: {} });
    expect(res.status).toBe(403);
  });
});
