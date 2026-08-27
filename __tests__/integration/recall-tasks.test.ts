import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { withRollback } from './helpers/db';
import {
  cleanupCreated,
  createTestAppointment,
  createTestEpisode,
  createTestPatient,
  createTestSlot,
  createTestUser,
  createTestWorkPhase,
} from './helpers/factories';
import {
  cleanupCreatedWp31,
  createTestRecallTask,
  createTestStageEvent,
  trackEpisodeRecallTasksForCleanup,
} from './helpers/factories-wp31';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { ensureRecallTasksForEpisode, syncRecallTasksForRiskChange } from '@/lib/recall-tasks';
import { GET as getRecallTasks, POST as postRecallTask } from '@/app/api/episodes/[id]/recall-tasks/route';
import { PATCH as patchEpisode } from '@/app/api/episodes/[id]/route';

/**
 * WP-3.1 + WP-3.2 (gondozás/recall): a 088-as CHECK-feloldás, a rizikó-alapú
 * auto-generálás, a kézi sorok együttélése és a rizikószint-váltás
 * viselkedési tesztjei — valódi DB-n, nem source-regexszel.
 */

afterEach(async () => {
  await cleanupCreatedWp31();
  await cleanupCreated();
});

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeDoctor(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

describe('088-as migráció — CHECK-feloldás és auto-unicitás', () => {
  it('tetszőleges pozitív recall_interval_days beszúrható (a régi 180/365 CHECK feloldva)', async () => {
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      for (const days of [7, 14, 21, 42]) {
        const row = await createTestRecallTask(client, {
          episodeId: episode.id,
          intervalDays: days,
          source: 'manual',
        });
        expect(row.recall_interval_days).toBe(days);
      }
    });
  });

  it('nem-pozitív intervallumot és érvénytelen source-t a CHECK elutasít', async () => {
    for (const days of [0, -5]) {
      await withRollback(async (client) => {
        const patient = await createTestPatient(client);
        const episode = await createTestEpisode(client, patient.id);
        await expect(
          createTestRecallTask(client, { episodeId: episode.id, intervalDays: days })
        ).rejects.toMatchObject({ code: '23514' });
      });
    }
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      await expect(
        client.query(
          `INSERT INTO episode_tasks (episode_id, task_type, due_at, recall_interval_days, source)
           VALUES ($1, 'recall_due', CURRENT_TIMESTAMP, 30, 'kézi')`,
          [episode.id]
        )
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('az (episode_id, interval) unicitás csak az auto sorokra él; kézi sorból többes is lehet', async () => {
    // Külön tranzakció az ütközésnek: a 23505 a tranzakciót is elrontja.
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      await createTestRecallTask(client, { episodeId: episode.id, intervalDays: 180, source: 'auto' });
      await expect(
        createTestRecallTask(client, { episodeId: episode.id, intervalDays: 180, source: 'auto' })
      ).rejects.toMatchObject({ code: '23505' });
    });

    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      // Auto mellett azonos intervallumú kézi sor is megfér…
      await createTestRecallTask(client, { episodeId: episode.id, intervalDays: 180, source: 'auto' });
      await createTestRecallTask(client, { episodeId: episode.id, intervalDays: 180, source: 'manual' });
      // …és kézi sorokra nincs unique-megkötés — akár azonos nappal is felvehető.
      await createTestRecallTask(client, { episodeId: episode.id, intervalDays: 14, source: 'manual' });
      await createTestRecallTask(client, { episodeId: episode.id, intervalDays: 14, source: 'manual' });
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM episode_tasks
          WHERE episode_id = $1 AND recall_interval_days = 14 AND source = 'manual'`,
        [episode.id]
      );
      expect(rows[0].cnt).toBe(2);
    });
  });
});

describe('auto-generálás — rizikó-kadencia és horgony', () => {
  it('rizikószint nélkül a mai low viselkedést adja: 6/12 hónapos pár a STAGE_6-tól, idempotensen', async () => {
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      const stage6At = new Date('2026-06-01T10:00:00.000Z');
      await createTestStageEvent(client, {
        patientId: patient.id,
        episodeId: episode.id,
        at: stage6At,
      });

      await ensureRecallTasksForEpisode(episode.id, client);
      await ensureRecallTasksForEpisode(episode.id, client); // idempotens

      const { rows } = await client.query(
        `SELECT recall_interval_days, due_at, source, label
           FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due'
          ORDER BY recall_interval_days`,
        [episode.id]
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r: any) => r.recall_interval_days)).toEqual([180, 365]);
      expect(rows.every((r: any) => r.source === 'auto')).toBe(true);
      expect(rows.map((r: any) => r.label)).toEqual(['6 hónapos kontroll', '12 hónapos kontroll']);
      expect(new Date(rows[0].due_at).getTime()).toBe(stage6At.getTime() + 180 * DAY_MS);
      expect(new Date(rows[1].due_at).getTime()).toBe(stage6At.getTime() + 365 * DAY_MS);
    });
  });

  it('high rizikónál a sűrűbb kadenciát generálja, a meglévő párt nem duplikálja', async () => {
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      await createTestStageEvent(client, { patientId: patient.id, episodeId: episode.id });

      await ensureRecallTasksForEpisode(episode.id, client);
      const lowIds = (
        await client.query(
          `SELECT id, recall_interval_days FROM episode_tasks
            WHERE episode_id = $1 AND task_type = 'recall_due' ORDER BY recall_interval_days`,
          [episode.id]
        )
      ).rows;

      await client.query(
        `UPDATE patient_episodes SET recall_risk_level = 'high' WHERE id = $1`,
        [episode.id]
      );
      await ensureRecallTasksForEpisode(episode.id, client);

      const { rows } = await client.query(
        `SELECT id, recall_interval_days FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due' ORDER BY recall_interval_days`,
        [episode.id]
      );
      expect(rows.map((r: any) => r.recall_interval_days)).toEqual([30, 90, 180, 365]);
      // A már létező 180/365 sor frissül, nem születik újra (id-k stabilak).
      const stableIds = rows.filter((r: any) => [180, 365].includes(r.recall_interval_days));
      expect(stableIds.map((r: any) => r.id).sort()).toEqual(lowIds.map((r: any) => r.id).sort());
    });
  });

  it('a horgony az utolsó teljesült kezelés/munkafázis, nem (csak) a STAGE_6', async () => {
    await withRollback(async (client) => {
      const doctor = await createTestUser(client);
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      const stage6At = new Date('2026-05-01T10:00:00.000Z');
      await createTestStageEvent(client, {
        patientId: patient.id,
        episodeId: episode.id,
        at: stage6At,
      });

      // Későbbi teljesült kontroll-időpont: ez lesz az új horgony.
      const controlAt = new Date('2026-06-10T09:00:00.000Z');
      const slot = await createTestSlot(client, doctor.id, { startTime: controlAt });
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: slot.id,
        episodeId: episode.id,
        startTime: controlAt,
        appointmentStatus: 'completed',
      });

      await ensureRecallTasksForEpisode(episode.id, client);
      const afterAppointment = await client.query(
        `SELECT recall_interval_days, due_at FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due' ORDER BY recall_interval_days`,
        [episode.id]
      );
      expect(new Date(afterAppointment.rows[0].due_at).getTime()).toBe(
        controlAt.getTime() + 180 * DAY_MS
      );
      expect(new Date(afterAppointment.rows[1].due_at).getTime()).toBe(
        controlAt.getTime() + 365 * DAY_MS
      );

      // Még későbbi teljesült munkafázis (időpont nélkül): a completed_at a horgony.
      const phaseCompletedAt = new Date('2026-07-01T12:00:00.000Z');
      await createTestWorkPhase(client, episode.id, {
        workPhaseCode: 'kontroll_1',
        pool: 'control',
        status: 'completed',
        completedAt: phaseCompletedAt,
      });

      await ensureRecallTasksForEpisode(episode.id, client);
      const afterPhase = await client.query(
        `SELECT recall_interval_days, due_at FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due' ORDER BY recall_interval_days`,
        [episode.id]
      );
      expect(new Date(afterPhase.rows[0].due_at).getTime()).toBe(
        phaseCompletedAt.getTime() + 180 * DAY_MS
      );
    });
  });

  it('teljesített auto sorhoz a horgony-eltolódás sem nyúl', async () => {
    await withRollback(async (client) => {
      const doctor = await createTestUser(client);
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      const stage6At = new Date('2026-05-01T10:00:00.000Z');
      await createTestStageEvent(client, {
        patientId: patient.id,
        episodeId: episode.id,
        at: stage6At,
      });
      await ensureRecallTasksForEpisode(episode.id, client);

      // A 6 hónapos sor teljesül…
      const originalDue = (
        await client.query(
          `UPDATE episode_tasks SET completed_at = CURRENT_TIMESTAMP
            WHERE episode_id = $1 AND task_type = 'recall_due' AND recall_interval_days = 180
            RETURNING due_at`,
          [episode.id]
        )
      ).rows[0].due_at;

      // …majd új teljesült időpont tolja a horgonyt.
      const controlAt = new Date('2026-11-05T09:00:00.000Z');
      const slot = await createTestSlot(client, doctor.id, { startTime: controlAt });
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: slot.id,
        episodeId: episode.id,
        startTime: controlAt,
        appointmentStatus: 'completed',
      });
      await ensureRecallTasksForEpisode(episode.id, client);

      const { rows } = await client.query(
        `SELECT recall_interval_days, due_at, completed_at FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due' ORDER BY recall_interval_days`,
        [episode.id]
      );
      // A teljesített 180-as sor határideje változatlan…
      expect(new Date(rows[0].due_at).getTime()).toBe(new Date(originalDue).getTime());
      expect(rows[0].completed_at).not.toBeNull();
      // …a nyitott 365-ös az új horgonyhoz igazodik.
      expect(new Date(rows[1].due_at).getTime()).toBe(controlAt.getTime() + 365 * DAY_MS);
    });
  });

  it('foglalt (nem teljesült) auto sorhoz a horgony-eltolódás nem nyúl', async () => {
    await withRollback(async (client) => {
      const doctor = await createTestUser(client);
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      const stage6At = new Date('2026-05-01T10:00:00.000Z');
      await createTestStageEvent(client, {
        patientId: patient.id,
        episodeId: episode.id,
        at: stage6At,
      });
      await ensureRecallTasksForEpisode(episode.id, client);

      // A 6 hónapos sorra időpontot foglalunk (aktív, NEM teljesült)…
      const bookedAt = new Date('2026-10-28T09:00:00.000Z');
      const bookedSlot = await createTestSlot(client, doctor.id, { startTime: bookedAt });
      const bookedAppointment = await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: bookedSlot.id,
        episodeId: episode.id,
        startTime: bookedAt,
        appointmentStatus: null,
      });
      const originalDue = (
        await client.query(
          `UPDATE episode_tasks SET appointment_id = $2
            WHERE episode_id = $1 AND task_type = 'recall_due' AND recall_interval_days = 180
            RETURNING due_at`,
          [episode.id, bookedAppointment.id]
        )
      ).rows[0].due_at;

      // …majd egy újabb teljesült időpont eltolja a horgonyt.
      const controlAt = new Date('2026-07-15T09:00:00.000Z');
      const controlSlot = await createTestSlot(client, doctor.id, { startTime: controlAt });
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: controlSlot.id,
        episodeId: episode.id,
        startTime: controlAt,
        appointmentStatus: 'completed',
      });
      await ensureRecallTasksForEpisode(episode.id, client);

      const { rows } = await client.query(
        `SELECT recall_interval_days, due_at, appointment_id, completed_at FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due' ORDER BY recall_interval_days`,
        [episode.id]
      );
      // A foglalt 180-as sor határideje NEM íródik át…
      expect(rows[0].appointment_id).toBe(bookedAppointment.id);
      expect(rows[0].completed_at).toBeNull();
      expect(new Date(rows[0].due_at).getTime()).toBe(new Date(originalDue).getTime());
      // …a foglalatlan 365-ös az új horgonyhoz igazodik.
      expect(new Date(rows[1].due_at).getTime()).toBe(controlAt.getTime() + 365 * DAY_MS);
    });
  });

  it('azonos intervallumú kézi sor mellé nem születik auto ikersor, és a kézi sor érintetlen marad', async () => {
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      await createTestStageEvent(client, { patientId: patient.id, episodeId: episode.id });

      const manualDue = new Date('2027-01-15T08:00:00.000Z');
      const manual = await createTestRecallTask(client, {
        episodeId: episode.id,
        intervalDays: 180,
        dueAt: manualDue,
        source: 'manual',
        label: 'Kézi féléves kontroll',
      });

      await ensureRecallTasksForEpisode(episode.id, client);

      const { rows } = await client.query(
        `SELECT id, recall_interval_days, due_at, source, label FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due'
          ORDER BY recall_interval_days, source`,
        [episode.id]
      );
      // 180-ból csak a kézi létezik, 365-ből csak az auto.
      expect(rows.map((r: any) => [r.recall_interval_days, r.source])).toEqual([
        [180, 'manual'],
        [365, 'auto'],
      ]);
      const manualRow = rows.find((r: any) => r.id === manual.id);
      expect(manualRow.label).toBe('Kézi féléves kontroll');
      expect(new Date(manualRow.due_at).getTime()).toBe(manualDue.getTime());
    });
  });

  it('kézi ikersor a MÁR LÉTEZŐ auto sor horgony-frissítését nem nyomja el', async () => {
    await withRollback(async (client) => {
      const doctor = await createTestUser(client);
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      const stage6At = new Date('2026-05-01T10:00:00.000Z');
      await createTestStageEvent(client, {
        patientId: patient.id,
        episodeId: episode.id,
        at: stage6At,
      });
      // Előbb létrejön az auto 180/365 pár…
      await ensureRecallTasksForEpisode(episode.id, client);

      // …majd az auto 180 MELLÉ kézi 180-as sor kerül.
      const manualDue = new Date('2027-01-15T08:00:00.000Z');
      const manual = await createTestRecallTask(client, {
        episodeId: episode.id,
        intervalDays: 180,
        dueAt: manualDue,
        source: 'manual',
        label: 'Kézi féléves kontroll',
      });

      // Új teljesült kontroll tolja a horgonyt.
      const controlAt = new Date('2026-06-10T09:00:00.000Z');
      const slot = await createTestSlot(client, doctor.id, { startTime: controlAt });
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: slot.id,
        episodeId: episode.id,
        startTime: controlAt,
        appointmentStatus: 'completed',
      });
      await ensureRecallTasksForEpisode(episode.id, client);

      const { rows } = await client.query(
        `SELECT id, recall_interval_days, due_at, source FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due'
          ORDER BY recall_interval_days, source`,
        [episode.id]
      );
      // Nincs ikersor: auto 180 + kézi 180 + auto 365.
      expect(rows.map((r: any) => [r.recall_interval_days, r.source])).toEqual([
        [180, 'auto'],
        [180, 'manual'],
        [365, 'auto'],
      ]);
      // Az auto 180 az ÚJ horgonyhoz igazodik (nem ragad a STAGE_6-on)…
      const auto180 = rows.find((r: any) => r.recall_interval_days === 180 && r.source === 'auto');
      expect(new Date(auto180.due_at).getTime()).toBe(controlAt.getTime() + 180 * DAY_MS);
      // …ahogy az auto 365 is; a kézi sor érintetlen.
      const auto365 = rows.find((r: any) => r.recall_interval_days === 365 && r.source === 'auto');
      expect(new Date(auto365.due_at).getTime()).toBe(controlAt.getTime() + 365 * DAY_MS);
      const manualRow = rows.find((r: any) => r.id === manual.id);
      expect(new Date(manualRow.due_at).getTime()).toBe(manualDue.getTime());
    });
  });
});

describe('rizikószint-váltás — syncRecallTasksForRiskChange', () => {
  it('új sorokat létrehoz, a kadenciából kikerült auto sorokat csak felajánlja törlésre', async () => {
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      await createTestStageEvent(client, { patientId: patient.id, episodeId: episode.id });

      await client.query(`UPDATE patient_episodes SET recall_risk_level = 'high' WHERE id = $1`, [
        episode.id,
      ]);
      await ensureRecallTasksForEpisode(episode.id, client);

      // Kézi rövid távú sor is van — sosem kerülhet a felajánlott listába.
      await createTestRecallTask(client, {
        episodeId: episode.id,
        intervalDays: 14,
        source: 'manual',
        label: '2 hetes sebgyógyulási kontroll',
      });

      // A 30 naposat teljesítjük — teljesített sor sem ajánlható fel törlésre.
      await client.query(
        `UPDATE episode_tasks SET completed_at = CURRENT_TIMESTAMP
          WHERE episode_id = $1 AND task_type = 'recall_due' AND recall_interval_days = 30`,
        [episode.id]
      );

      await client.query(`UPDATE patient_episodes SET recall_risk_level = 'low' WHERE id = $1`, [
        episode.id,
      ]);
      const result = await syncRecallTasksForRiskChange(episode.id, client);

      // Csak a nyitott, foglalatlan, kadencián kívüli auto sor (90) ajánlott.
      expect(result.obsoleteAutoTasks.map((t) => t.intervalDays)).toEqual([90]);

      // Semmi nem törlődött: mind az 5 sor (30/90/180/365 auto + 14 kézi) megvan.
      const { rows } = await client.query(
        `SELECT recall_interval_days, source FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due'
          ORDER BY recall_interval_days`,
        [episode.id]
      );
      expect(rows.map((r: any) => [r.recall_interval_days, r.source])).toEqual([
        [14, 'manual'],
        [30, 'auto'],
        [90, 'auto'],
        [180, 'auto'],
        [365, 'auto'],
      ]);
    });
  });

  it('foglalt (nem teljesült) auto sort nem ajánl fel törlésre', async () => {
    await withRollback(async (client) => {
      const doctor = await createTestUser(client);
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      await createTestStageEvent(client, { patientId: patient.id, episodeId: episode.id });

      await client.query(`UPDATE patient_episodes SET recall_risk_level = 'high' WHERE id = $1`, [
        episode.id,
      ]);
      await ensureRecallTasksForEpisode(episode.id, client);

      // A 90 napos auto sorra aktív (NEM teljesült) foglalás kerül.
      const slot = await createTestSlot(client, doctor.id);
      const appointment = await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: slot.id,
        episodeId: episode.id,
        appointmentStatus: null,
      });
      await client.query(
        `UPDATE episode_tasks SET appointment_id = $2
          WHERE episode_id = $1 AND task_type = 'recall_due' AND recall_interval_days = 90`,
        [episode.id, appointment.id]
      );

      await client.query(`UPDATE patient_episodes SET recall_risk_level = 'low' WHERE id = $1`, [
        episode.id,
      ]);
      const result = await syncRecallTasksForRiskChange(episode.id, client);

      // A kadencián kívüli 30 felajánlott, de a foglalt 90 NEM.
      expect(result.obsoleteAutoTasks.map((t) => t.intervalDays)).toEqual([30]);

      // A foglalt sor és a foglalása érintetlen.
      const { rows } = await client.query(
        `SELECT appointment_id FROM episode_tasks
          WHERE episode_id = $1 AND task_type = 'recall_due' AND recall_interval_days = 90`,
        [episode.id]
      );
      expect(rows[0].appointment_id).toBe(appointment.id);
    });
  });
});

describe('POST /api/episodes/:id/recall-tasks — kézi visszarendelés', () => {
  it('tetszőleges pozitív nappal és címkével vesz fel kézi sort, created_by a JWT-ből', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/recall-tasks`,
      {
        user: doctor,
        method: 'POST',
        body: { intervalDays: 14, label: '2 hetes sebgyógyulási kontroll' },
      }
    );
    const res = await postRecallTask(req, { params: { id: episode.id } });
    await trackEpisodeRecallTasksForCleanup(episode.id);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.recallTask).toMatchObject({
      episodeId: episode.id,
      intervalDays: 14,
      source: 'manual',
      label: '2 hetes sebgyógyulási kontroll',
      createdBy: doctor.id,
    });

    const pool = getDbPool();
    const { rows } = await pool.query(
      `SELECT source, label, created_by, due_at FROM episode_tasks WHERE id = $1`,
      [json.recallTask.id]
    );
    expect(rows[0].source).toBe('manual');
    expect(rows[0].created_by).toBe(doctor.id);
    // A határidő ~ma + 14 nap.
    const expectedDue = Date.now() + 14 * DAY_MS;
    expect(Math.abs(new Date(rows[0].due_at).getTime() - expectedDue)).toBeLessThan(60_000);
  });

  it('címke nélkül generált címkét kap, nem-pozitív nap 400', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const okReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/recall-tasks`,
      { user: doctor, method: 'POST', body: { intervalDays: 21 } }
    );
    const okRes = await postRecallTask(okReq, { params: { id: episode.id } });
    await trackEpisodeRecallTasksForCleanup(episode.id);
    expect(okRes.status).toBe(201);
    expect((await okRes.json()).recallTask.label).toBe('3 hetes kontroll');

    for (const bad of [0, -7, 'nem-szám', null]) {
      const badReq = await authedRequest(
        `http://test.local/api/episodes/${episode.id}/recall-tasks`,
        { user: doctor, method: 'POST', body: { intervalDays: bad } }
      );
      const badRes = await postRecallTask(badReq, { params: { id: episode.id } });
      expect(badRes.status).toBe(400);
    }
  });

  it('lezárt epizódra 409, nemlétező epizódra 404', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const closed = await createTestEpisode(undefined, patient.id, { status: 'closed' });

    const closedReq = await authedRequest(
      `http://test.local/api/episodes/${closed.id}/recall-tasks`,
      { user: doctor, method: 'POST', body: { intervalDays: 14 } }
    );
    expect((await postRecallTask(closedReq, { params: { id: closed.id } })).status).toBe(409);

    const missingId = '00000000-0000-4000-8000-000000000000';
    const missingReq = await authedRequest(
      `http://test.local/api/episodes/${missingId}/recall-tasks`,
      { user: doctor, method: 'POST', body: { intervalDays: 14 } }
    );
    expect((await postRecallTask(missingReq, { params: { id: missingId } })).status).toBe(404);
  });

  it('a GET a kézi és auto sorokat együtt, esedékesség szerint adja vissza, és nem duplikálja a kézit', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const pool = getDbPool();
    await createTestStageEvent(undefined, {
      patientId: patient.id,
      episodeId: episode.id,
      at: new Date('2026-06-01T10:00:00.000Z'),
    });

    const postReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/recall-tasks`,
      { user: doctor, method: 'POST', body: { intervalDays: 14, label: 'Varratszedés utáni kontroll' } }
    );
    expect((await postRecallTask(postReq, { params: { id: episode.id } })).status).toBe(201);

    // A GET önjavítóan legenerálja az auto párt is (STAGE_6 megvan).
    const getReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/recall-tasks`,
      { user: doctor }
    );
    const getRes = await getRecallTasks(getReq, { params: { id: episode.id } });
    await trackEpisodeRecallTasksForCleanup(episode.id);

    expect(getRes.status).toBe(200);
    const { recallTasks } = await getRes.json();
    expect(recallTasks.map((t: any) => [t.intervalDays, t.source])).toEqual([
      [14, 'manual'],
      [180, 'auto'],
      [365, 'auto'],
    ]);
    // Esedékesség szerint rendezett.
    const dues = recallTasks.map((t: any) => new Date(t.dueAt).getTime());
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);

    // Ismételt GET (= ismételt ensure) után sincs duplikáció.
    const getReq2 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/recall-tasks`,
      { user: doctor }
    );
    const getRes2 = await getRecallTasks(getReq2, { params: { id: episode.id } });
    expect((await getRes2.json()).recallTasks).toHaveLength(3);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM episode_tasks WHERE episode_id = $1 AND task_type = 'recall_due'`,
      [episode.id]
    );
    expect(rows[0].cnt).toBe(3);
  });
});

describe('PATCH /api/episodes/:id — recallRiskLevel', () => {
  it('állítja a rizikószintet, új auto sorokat hoz és a felesleges auto sorokat csak felajánlja', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const pool = getDbPool();
    await createTestStageEvent(undefined, { patientId: patient.id, episodeId: episode.id });

    // high: 30/90/180/365 auto sor jön létre
    const highReq = await authedRequest(`http://test.local/api/episodes/${episode.id}`, {
      user: doctor,
      method: 'PATCH',
      body: { recallRiskLevel: 'high' },
    });
    const highRes = await patchEpisode(highReq, { params: { id: episode.id } });
    await trackEpisodeRecallTasksForCleanup(episode.id);
    expect(highRes.status).toBe(200);
    const highJson = await highRes.json();
    expect(highJson.episode.recallRiskLevel).toBe('high');
    expect(highJson.recall.obsoleteAutoTasks).toEqual([]);

    const afterHigh = await pool.query(
      `SELECT recall_interval_days FROM episode_tasks
        WHERE episode_id = $1 AND task_type = 'recall_due' ORDER BY recall_interval_days`,
      [episode.id]
    );
    expect(afterHigh.rows.map((r: any) => r.recall_interval_days)).toEqual([30, 90, 180, 365]);

    // vissza low-ra: a 30/90 törlésre FELAJÁNLOTT, de nem törölt
    const lowReq = await authedRequest(`http://test.local/api/episodes/${episode.id}`, {
      user: doctor,
      method: 'PATCH',
      body: { recallRiskLevel: 'low' },
    });
    const lowRes = await patchEpisode(lowReq, { params: { id: episode.id } });
    expect(lowRes.status).toBe(200);
    const lowJson = await lowRes.json();
    expect(lowJson.episode.recallRiskLevel).toBe('low');
    expect(lowJson.recall.obsoleteAutoTasks.map((t: any) => t.intervalDays).sort((a: number, b: number) => a - b)).toEqual([30, 90]);

    const afterLow = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM episode_tasks WHERE episode_id = $1 AND task_type = 'recall_due'`,
      [episode.id]
    );
    expect(afterLow.rows[0].cnt).toBe(4);
  });

  it('érvénytelen rizikószintre 400', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const req = await authedRequest(`http://test.local/api/episodes/${episode.id}`, {
      user: doctor,
      method: 'PATCH',
      body: { recallRiskLevel: 'extrém' },
    });
    expect((await patchEpisode(req, { params: { id: episode.id } })).status).toBe(400);
  });
});
