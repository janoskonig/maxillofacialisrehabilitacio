import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { GET as getWorkPhases } from '@/app/api/episodes/[id]/work-phases/route';
import { GET as adminScan } from '@/app/api/admin/scheduling-integrity/route';
import {
  getLostAppointmentWorkPhaseIds,
  repairSchedulingIntegrity,
} from '@/lib/scheduling-integrity';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
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
      `SELECT old_status, new_status, reason, change_type FROM episode_work_phase_audit
       WHERE episode_id = $1 AND episode_work_phase_id = $2`,
      [episode.id, wp.id]
    );
    expect(audit1.rows).toHaveLength(1);
    expect(audit1.rows[0].old_status).toBe('scheduled');
    expect(audit1.rows[0].new_status).toBe('pending');
    expect(audit1.rows[0].change_type).toBe('integrity_repair');
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

  it('fogpótlástanász sem futtathatja a scant (403) — a tömeges auto-repair csak admin', async () => {
    const doc = await createTestUser(undefined, { role: 'fogpótlástanász' });
    const req = await authedRequest(
      'http://test.local/api/admin/scheduling-integrity',
      { user: { id: doc.id, email: doc.email, role: 'fogpótlástanász' } }
    );
    const res = await adminScan(req, { params: {} });
    expect(res.status).toBe(403);
  });
});

/**
 * Két EWP sor ugyanarra az AKTÍV appointmentre mutat (nincs unique index az
 * appointment_id-n). Az auto-repair ilyenkor NEM írhat semmit — korábban a
 * mismatch-javítás futásonként másik fázishoz igazította a step_code-ot
 * (flip-flop). Az eset a nem-javítható maradék-listára kerül
 * (MULTI_EWP_APPOINTMENT_LINK).
 */
async function setupMultiLink() {
  const pool = getDbPool();
  const user = await createTestUser();
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  createdEpisodeIds.push(episode.id);

  const wp1 = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    status: 'scheduled',
    seq: 0,
    pathwayOrderIndex: 0,
  });
  const wp2 = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'koronaproba',
    status: 'scheduled',
    seq: 1,
    pathwayOrderIndex: 1,
  });
  const slot = await createTestSlot(undefined, user.id, {
    state: 'booked',
    status: 'booked',
  });
  const appt = await createTestAppointment(undefined, {
    patientId: patient.id,
    timeSlotId: slot.id,
    episodeId: episode.id,
    workPhaseId: wp1.id,
    stepCode: 'lenyomat',
    stepSeq: 0,
    appointmentStatus: null, // aktív
  });
  await pool.query(
    `UPDATE episode_work_phases SET appointment_id = $1 WHERE id = $2 OR id = $3`,
    [appt.id, wp1.id, wp2.id]
  );

  return { user, patient, episode, wp1, wp2, appt };
}

describe('WP-1.2 review: multi-link — több EWP ugyanarra az aktív foglalásra', () => {
  it('a repair nem ír semmit (nincs flip-flop), két futás után is stabil', async () => {
    const pool = getDbPool();
    const { user, episode, appt } = await setupMultiLink();

    // 1. olvasás — az auto-repair felismeri a multi-linket és NEM ír
    const res1 = await callWorkPhasesGet(user, episode.id);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.autoRepair).toEqual({ danglingCleared: 0, mismatchRepaired: 0 });

    const apptRow1 = await pool.query(
      `SELECT step_code, step_seq FROM appointments WHERE id = $1`,
      [appt.id]
    );
    expect(apptRow1.rows[0].step_code).toBe('lenyomat');
    expect(apptRow1.rows[0].step_seq).toBe(0);

    // 2. olvasás — ugyanaz az állapot: a step_code nem billeg át a másik fázisra
    const res2 = await callWorkPhasesGet(user, episode.id);
    const body2 = await res2.json();
    expect(body2.autoRepair).toEqual({ danglingCleared: 0, mismatchRepaired: 0 });

    const apptRow2 = await pool.query(
      `SELECT step_code, step_seq FROM appointments WHERE id = $1`,
      [appt.id]
    );
    expect(apptRow2.rows[0].step_code).toBe('lenyomat');
    expect(apptRow2.rows[0].step_seq).toBe(0);

    // Írás (audit) egyáltalán nem történt
    expect(await auditCount(episode.id)).toBe(0);
  });

  it('az admin-scan a nem-javítható maradék-listára teszi (MULTI_EWP_APPOINTMENT_LINK), stabilan', async () => {
    const pool = getDbPool();
    const { episode, wp1, wp2, appt } = await setupMultiLink();
    const admin = await createTestUser(undefined, { role: 'admin' });

    const runScan = async () => {
      const req = await authedRequest(
        'http://test.local/api/admin/scheduling-integrity',
        { user: { id: admin.id, email: admin.email, role: 'admin' } }
      );
      const res = await adminScan(req, { params: {} });
      expect(res.status).toBe(200);
      return res.json();
    };

    const body1 = await runScan();
    const ourEpisode1 = (body1.episodes as Array<{
      episodeId: string;
      violations: Array<{
        kind: string;
        repairable?: boolean;
        workPhaseIds?: string[];
        appointmentIds?: string[];
      }>;
    }>).find((e) => e.episodeId === episode.id);
    expect(ourEpisode1).toBeTruthy();
    const multi1 = ourEpisode1!.violations.find(
      (v) => v.kind === 'MULTI_EWP_APPOINTMENT_LINK'
    );
    expect(multi1).toBeTruthy();
    expect(multi1!.repairable).toBe(false);
    expect(multi1!.appointmentIds).toContain(appt.id);
    expect(multi1!.workPhaseIds).toEqual(expect.arrayContaining([wp1.id, wp2.id]));
    // A multi-linkes sorok nem jelennek meg "javítható" mismatch-ként
    expect(
      ourEpisode1!.violations.some((v) => v.kind === 'APPOINTMENT_STEP_MISMATCH')
    ).toBe(false);

    // Második scan: változatlan állapot, semmi írás
    const body2 = await runScan();
    const ourEpisode2 = (body2.episodes as Array<{
      episodeId: string;
      violations: Array<{ kind: string }>;
    }>).find((e) => e.episodeId === episode.id);
    expect(
      ourEpisode2?.violations.some((v) => v.kind === 'MULTI_EWP_APPOINTMENT_LINK')
    ).toBe(true);

    const apptRow = await pool.query(
      `SELECT step_code, step_seq FROM appointments WHERE id = $1`,
      [appt.id]
    );
    expect(apptRow.rows[0].step_code).toBe('lenyomat');
    expect(apptRow.rows[0].step_seq).toBe(0);
    expect(await auditCount(episode.id)).toBe(0);
  });
});

describe('WP-1.2 review: audit MINDEN tényleges link-nullázásra (nem csak scheduled)', () => {
  it('completed sor dangling-takarítása is ír auditot (change_type=integrity_repair)', async () => {
    const pool = getDbPool();
    const user = await createTestUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    const wp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      status: 'completed',
      seq: 0,
      completedAt: new Date(),
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
    await pool.query(
      `UPDATE episode_work_phases SET appointment_id = $1 WHERE id = $2`,
      [appt.id, wp.id]
    );

    const res = await callWorkPhasesGet(user, episode.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoRepair).toEqual({ danglingCleared: 1, mismatchRepaired: 0 });

    // A link kitakarítva, a completed státusz érintetlen
    const ewpRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [wp.id]
    );
    expect(ewpRow.rows[0].status).toBe('completed');
    expect(ewpRow.rows[0].appointment_id).toBeNull();

    // Az audit-sor most már ilyenkor is megvan (WP-2.1 elv)
    const audit = await pool.query(
      `SELECT old_status, new_status, change_type, reason
       FROM episode_work_phase_audit
       WHERE episode_id = $1 AND episode_work_phase_id = $2`,
      [episode.id, wp.id]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].old_status).toBe('completed');
    expect(audit.rows[0].new_status).toBe('completed');
    expect(audit.rows[0].change_type).toBe('integrity_repair');
    expect(audit.rows[0].reason).toContain('dangling appointment_id takarítása');

    // A klinikai sor-jelzés csak pending sorokra szól — completed nem kap jelzést
    expect(body.lostAppointmentWorkPhaseIds).not.toContain(wp.id);
  });
});

describe('WP-1.2 review: sor-jelzés robusztussága (change_type-alapú szűrés)', () => {
  it('túléli a közbeeső timing_change auditot, de eltűnik új foglalásnál', async () => {
    const pool = getDbPool();
    const { user, patient, episode, wp } = await setupDanglingLink();

    // Repair → jelzés él
    const res1 = await callWorkPhasesGet(user, episode.id);
    const body1 = await res1.json();
    expect(body1.autoRepair).toEqual({ danglingCleared: 1, mismatchRepaired: 0 });
    expect(body1.lostAppointmentWorkPhaseIds).toContain(wp.id);

    // Közbeeső, linket nem érintő audit (időzítés/címke módosítás) — a jelzés marad
    await insertWorkPhaseAudit(pool, {
      episodeWorkPhaseId: wp.id,
      episodeId: episode.id,
      oldStatus: 'pending',
      newStatus: 'pending',
      changedBy: 'integration-teszt',
      changeType: 'timing_change',
      reason: 'időtartam módosítva 30 → 45 perc',
    });
    expect(await getLostAppointmentWorkPhaseIds(pool, episode.id)).toContain(wp.id);

    const resMid = await callWorkPhasesGet(user, episode.id);
    const bodyMid = await resMid.json();
    expect(bodyMid.autoRepair).toEqual({ danglingCleared: 0, mismatchRepaired: 0 });
    expect(bodyMid.lostAppointmentWorkPhaseIds).toContain(wp.id);

    // Új foglalás a fázisra (a booking-flow könyvelését tükrözve) — a jelzés eltűnik
    const slot2 = await createTestSlot(undefined, user.id, {
      state: 'booked',
      status: 'booked',
    });
    const newAppt = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot2.id,
      episodeId: episode.id,
      workPhaseId: wp.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      appointmentStatus: null, // aktív
    });
    await pool.query(
      `UPDATE episode_work_phases SET appointment_id = $1, status = 'scheduled' WHERE id = $2`,
      [newAppt.id, wp.id]
    );
    await insertWorkPhaseAudit(pool, {
      episodeWorkPhaseId: wp.id,
      episodeId: episode.id,
      oldStatus: 'pending',
      newStatus: 'scheduled',
      changedBy: 'integration-teszt',
      reason: 'új időpont foglalva',
    });

    const res2 = await callWorkPhasesGet(user, episode.id);
    const body2 = await res2.json();
    expect(body2.autoRepair).toEqual({ danglingCleared: 0, mismatchRepaired: 0 });
    expect(body2.lostAppointmentWorkPhaseIds).not.toContain(wp.id);
    expect(await getLostAppointmentWorkPhaseIds(pool, episode.id)).not.toContain(wp.id);
  });
});

describe('WP-1.2 review: versenyhelyzet — friss, aktív foglalás linkje sérthetetlen', () => {
  it('párhuzamos foglalási tranzakció commitja után a repair nem nullázza a friss linket', async () => {
    const pool = getDbPool();
    const { user, patient, episode, wp } = await setupDanglingLink();

    // Új, AKTÍV foglalás egy külön tranzakcióban — a commit szándékosan
    // a repair futása KÖZBEN történik (a repair recheck FOR UPDATE-je a
    // zárolt EWP soron várakozik, majd a friss linket látja).
    const slot2 = await createTestSlot(undefined, user.id, {
      state: 'booked',
      status: 'booked',
    });
    const freshAppt = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot2.id,
      episodeId: episode.id,
      workPhaseId: wp.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      appointmentStatus: null, // aktív
    });

    const bookingClient = await pool.connect();
    try {
      await bookingClient.query('BEGIN');
      // A "foglalási tranzakció": átlinkeli az EWP-t a friss foglalásra,
      // és fogja a sor-lockot, amíg nem commitol.
      await bookingClient.query(
        `UPDATE episode_work_phases SET appointment_id = $1, status = 'scheduled' WHERE id = $2`,
        [freshAppt.id, wp.id]
      );

      // A repair közben indul: az első (lock nélküli) detektáló SELECT még a
      // stale linket látja, a tranzakción belüli recheck viszont a lockon vár.
      const repairPromise = repairSchedulingIntegrity(pool, episode.id, {
        changedBy: 'race-teszt',
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await bookingClient.query('COMMIT');

      const result = await repairPromise;
      // A friss, aktív foglalás linkjét NEM nullázta
      expect(result.danglingCleared).toBe(0);
      expect(result.clearedWorkPhaseIds).not.toContain(wp.id);
    } catch (err) {
      await bookingClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      bookingClient.release();
    }

    const ewpRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [wp.id]
    );
    expect(ewpRow.rows[0].appointment_id).toBe(freshAppt.id);
    expect(ewpRow.rows[0].status).toBe('scheduled');

    // Hamis audit-sor sem született (a számláló a tényleges rowCount-on alapul)
    expect(await auditCount(episode.id)).toBe(0);
  });
});
