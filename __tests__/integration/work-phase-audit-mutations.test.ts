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
import { POST as createWorkPhase } from '@/app/api/episodes/[id]/work-phases/route';
import { PATCH as patchWorkPhase, DELETE as deleteWorkPhase } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';
import { PATCH as reorderWorkPhases } from '@/app/api/episodes/[id]/work-phases/reorder/route';
import { POST as mergeWorkPhases } from '@/app/api/episodes/[id]/work-phases/merge/route';
import { POST as unmergeWorkPhases } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/unmerge/route';
import { POST as generateWorkPhases } from '@/app/api/episodes/[id]/work-phases/generate/route';
import { PATCH as patchEpisode } from '@/app/api/episodes/[id]/route';
import { POST as createEpisodeFromToothTreatment } from '@/app/api/patients/[id]/tooth-treatments/[treatmentId]/create-episode/route';

/**
 * WP-2.1: minden terv-mutáció írjon auditot (change_type, 087-es migráció).
 *
 * A terv elfogadási kritériuma: "6 különböző mutáció után 6 napló sor, helyes
 * change_type-pal; törölt fázis sora is olvasható marad". Viselkedési tesztek:
 * a valódi route-handlereket hívjuk (azok COMMIT-olnak), ezért a factory-k
 * pool-lal futnak és afterEach takarít.
 */

afterEach(async () => {
  await cleanupCreatedWp07();
  await cleanupCreated();
});

async function makeDoctor(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

type AuditRow = {
  episode_work_phase_id: string | null;
  change_type: string;
  old_status: string | null;
  new_status: string | null;
  work_phase_code: string | null;
  custom_label: string | null;
  changed_by: string;
  reason: string | null;
};

async function auditRows(episodeId: string): Promise<AuditRow[]> {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT episode_work_phase_id, change_type, old_status, new_status,
            work_phase_code, custom_label, changed_by, reason
       FROM episode_work_phase_audit
      WHERE episode_id = $1
      ORDER BY created_at`,
    [episodeId]
  );
  return rows;
}

describe('terv-mutációk auditja (WP-2.1)', () => {
  it('6 különböző mutáció után 6 napló sor, helyes change_type-pal; a törölt fázis sora olvasható marad', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    // Seed (factory, audit nélkül): két meglévő fázis.
    const x = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      durationMinutes: 30,
    });
    const y = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'atadas',
      seq: 1,
    });

    // 1. mutáció — LÉTREHOZÁS (szabadszöveges).
    const createReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases`,
      { user: doctor, method: 'POST', body: { label: 'Egyedi köztes fázis' } }
    );
    const createRes = await createWorkPhase(createReq, { params: { id: episode.id } });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).workPhase;
    const zId: string = created.id;
    const zCode: string = created.workPhaseCode;

    // 2. mutáció — IDŐZÍTÉS-MÓDOSÍTÁS (duration 30 → 55).
    const timingReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${x.id}`,
      { user: doctor, method: 'PATCH', body: { durationMinutes: 55 } }
    );
    const timingRes = await patchWorkPhase(timingReq, {
      params: { id: episode.id, workPhaseId: x.id },
    });
    expect(timingRes.status).toBe(200);

    // 3. mutáció — ÁTRENDEZÉS ([X, Y, Z] → [Z, X, Y]).
    const reorderReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/reorder`,
      { user: doctor, method: 'PATCH', body: { stepIds: [zId, x.id, y.id] } }
    );
    const reorderRes = await reorderWorkPhases(reorderReq, { params: { id: episode.id } });
    expect(reorderRes.status).toBe(200);

    // 4. mutáció — ÖSSZEVONÁS (Y beolvasztása X alá).
    const mergeReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/merge`,
      { user: doctor, method: 'POST', body: { stepIds: [x.id, y.id] } }
    );
    const mergeRes = await mergeWorkPhases(mergeReq, { params: { id: episode.id } });
    expect(mergeRes.status).toBe(200);

    // 5. mutáció — STÁTUSZ-VÁLTÁS (X: pending → completed).
    const statusReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${x.id}`,
      { user: doctor, method: 'PATCH', body: { status: 'completed' } }
    );
    const statusRes = await patchWorkPhase(statusReq, {
      params: { id: episode.id, workPhaseId: x.id },
    });
    expect(statusRes.status).toBe(200);

    // 6. mutáció — TÖRLÉS (Z).
    const deleteReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${zId}`,
      { user: doctor, method: 'DELETE' }
    );
    const deleteRes = await deleteWorkPhase(deleteReq, {
      params: { id: episode.id, workPhaseId: zId },
    });
    expect(deleteRes.status).toBe(200);

    const rows = await auditRows(episode.id);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.change_type)).toEqual([
      'create',
      'timing_change',
      'reorder',
      'merge',
      'status_change',
      'delete',
    ]);
    for (const row of rows) {
      expect(row.changed_by).toBe(doctor.email);
    }

    // Létrehozás: nincs old_status, az új sor pending; a Z későbbi törlése
    // miatt az FK már elengedve (SET NULL), de a snapshot olvasható.
    const createRow = rows[0];
    expect(createRow.episode_work_phase_id).toBeNull();
    expect(createRow.old_status).toBeNull();
    expect(createRow.new_status).toBe('pending');
    expect(createRow.work_phase_code).toBe(zCode);
    expect(createRow.custom_label).toBe('Egyedi köztes fázis');

    // Időzítés-módosítás: a státusz nem változik, a reason a tényleges váltást írja.
    const timingRow = rows[1];
    expect(timingRow.episode_work_phase_id).toBe(x.id);
    expect(timingRow.old_status).toBe('pending');
    expect(timingRow.new_status).toBe('pending');
    expect(timingRow.reason).toContain('30→55');

    // Átrendezés: EGY epizód-szintű összefoglaló sor, a mozgatott fázisok kódjával.
    const reorderRow = rows[2];
    expect(reorderRow.episode_work_phase_id).toBeNull();
    expect(reorderRow.old_status).toBeNull();
    expect(reorderRow.new_status).toBeNull();
    expect(reorderRow.reason).toContain('lenyomat');
    expect(reorderRow.reason).toContain(zCode);

    // Összevonás: a másodlagos (beolvasztott) fázis sora, az elsődleges kódjával.
    const mergeRow = rows[3];
    expect(mergeRow.episode_work_phase_id).toBe(y.id);
    expect(mergeRow.work_phase_code).toBe('atadas');
    expect(mergeRow.reason).toContain('lenyomat');

    // Státusz-váltás: a klasszikus old→new pár.
    const statusRow = rows[4];
    expect(statusRow.episode_work_phase_id).toBe(x.id);
    expect(statusRow.old_status).toBe('pending');
    expect(statusRow.new_status).toBe('completed');

    // Törlés: a fázis már nincs, de a sor olvasható marad (tombstone snapshot).
    const deleteRow = rows[5];
    expect(deleteRow.episode_work_phase_id).toBeNull();
    expect(deleteRow.new_status).toBe('deleted');
    expect(deleteRow.work_phase_code).toBe(zCode);
    expect(deleteRow.custom_label).toBe('Egyedi köztes fázis');
  });

  it('felbontás (unmerge): a kiengedett fázis kap unmerge sort az elsődleges kódjával', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const a = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
    });
    const b = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'atadas',
      seq: 1,
    });

    const mergeReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/merge`,
      { user: doctor, method: 'POST', body: { stepIds: [a.id, b.id] } }
    );
    expect((await mergeWorkPhases(mergeReq, { params: { id: episode.id } })).status).toBe(200);

    const unmergeReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${a.id}/unmerge`,
      { user: doctor, method: 'POST' }
    );
    expect(
      (await unmergeWorkPhases(unmergeReq, { params: { id: episode.id, workPhaseId: a.id } }))
        .status
    ).toBe(200);

    const rows = await auditRows(episode.id);
    expect(rows.map((r) => r.change_type)).toEqual(['merge', 'unmerge']);
    const unmergeRow = rows[1];
    expect(unmergeRow.episode_work_phase_id).toBe(b.id);
    expect(unmergeRow.old_status).toBe('pending');
    expect(unmergeRow.new_status).toBe('pending');
    expect(unmergeRow.reason).toContain('lenyomat');
    expect(unmergeRow.changed_by).toBe(doctor.email);
  });

  it('sablon alkalmazása/eltávolítása: template_apply csak tényleges beszúráskor, template_remove fázisonként', async () => {
    const pool = getDbPool();
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const tt = await createWp07TreatmentType();
    const cp = await createWp07CarePathway(undefined, tt.id, {
      name: 'WP-2.1 audit sablon',
    });
    await pool.query(`UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`, [
      cp.id,
      episode.id,
    ]);

    // 1. generate — a sablon 3 fázisa beszúródik, fázisonként template_apply sorral.
    const genReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/generate`,
      { user: doctor, method: 'POST' }
    );
    const genRes = await generateWorkPhases(genReq, { params: { id: episode.id } });
    expect(genRes.status).toBe(201);

    let rows = await auditRows(episode.id);
    const applyRows = rows.filter((r) => r.change_type === 'template_apply');
    expect(applyRows).toHaveLength(3);
    for (const row of applyRows) {
      expect(row.old_status).toBeNull();
      expect(row.new_status).toBe('pending');
      expect(row.changed_by).toBe(doctor.email);
      expect(row.reason).toContain('WP-2.1 audit sablon');
      expect(row.episode_work_phase_id).not.toBeNull();
    }

    // 2. generate — idempotens, nem szúr be semmit → nem ír új napló-sort.
    const genReq2 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/generate`,
      { user: doctor, method: 'POST' }
    );
    const genRes2 = await generateWorkPhases(genReq2, { params: { id: episode.id } });
    expect(genRes2.status).toBe(200);
    rows = await auditRows(episode.id);
    expect(rows.filter((r) => r.change_type === 'template_apply')).toHaveLength(3);

    // Sablon eltávolítása — fázisonként template_remove sor, tombstone snapshottal.
    const removeReq = await authedRequest(`http://test.local/api/episodes/${episode.id}`, {
      user: doctor,
      method: 'PATCH',
      body: { action: 'removePathway', carePathwayId: cp.id },
    });
    const removeRes = await patchEpisode(removeReq, { params: { id: episode.id } });
    expect(removeRes.status).toBe(200);

    rows = await auditRows(episode.id);
    const removeRows = rows.filter((r) => r.change_type === 'template_remove');
    expect(removeRows).toHaveLength(3);
    expect(removeRows.map((r) => r.work_phase_code).sort()).toEqual(
      ['atadas', 'konzultacio', 'lenyomat'].sort()
    );
    for (const row of removeRows) {
      expect(row.episode_work_phase_id).toBeNull();
      expect(row.new_status).toBe('deleted');
      expect(row.changed_by).toBe(doctor.email);
    }
  });

  it('sablon alkalmazása addPathway-jel (EpisodePathwayEditor útja): fázisonkénti template_apply sor', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const tt = await createWp07TreatmentType();
    const cp = await createWp07CarePathway(undefined, tt.id, {
      name: 'WP-2.1 addPathway sablon',
    });

    const addReq = await authedRequest(`http://test.local/api/episodes/${episode.id}`, {
      user: doctor,
      method: 'PATCH',
      body: { action: 'addPathway', carePathwayId: cp.id },
    });
    const addRes = await patchEpisode(addReq, { params: { id: episode.id } });
    expect(addRes.status).toBe(201);

    const rows = await auditRows(episode.id);
    // Csak a sablon-alkalmazás sorai — a 3 fázis mindegyike template_apply-t kap.
    expect(rows).toHaveLength(3);
    const applyRows = rows.filter((r) => r.change_type === 'template_apply');
    expect(applyRows).toHaveLength(3);
    expect(applyRows.map((r) => r.work_phase_code).sort()).toEqual(
      ['atadas', 'konzultacio', 'lenyomat'].sort()
    );
    for (const row of applyRows) {
      expect(row.episode_work_phase_id).not.toBeNull();
      expect(row.old_status).toBeNull();
      expect(row.new_status).toBe('pending');
      expect(row.changed_by).toBe(doctor.email);
      expect(row.reason).toContain('WP-2.1 addPathway sablon');
    }
  });

  it('epizód fogkezelésből (create-episode): sablon-fázisokra template_apply, fog-fázisra create sor', async () => {
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    // Meglévő nyitott epizód — a route ehhez kapcsolja a fogkezelést.
    const episode = await createTestEpisode(undefined, patient.id);
    const tt = await createWp07TreatmentType();
    const cp = await createWp07CarePathway(undefined, tt.id, {
      name: 'WP-2.1 fog-sablon',
    });
    const catalog = await createWp07ToothTreatmentCatalogEntry(undefined, {
      defaultCarePathwayId: cp.id,
    });
    const tooth = await createWp07ToothTreatment(undefined, patient.id, null, catalog.code, {
      status: 'pending',
      toothNumber: 21,
    });

    const req = await authedRequest(
      `http://test.local/api/patients/${patient.id}/tooth-treatments/${tooth.id}/create-episode`,
      { user: doctor, method: 'POST', body: {} }
    );
    const res = await createEpisodeFromToothTreatment(req, {
      params: { id: patient.id, treatmentId: tooth.id },
    });
    expect(res.status).toBe(200);
    const resBody = await res.json();
    expect(resBody.episodeId).toBe(episode.id);
    expect(resBody.pathwayAssigned).toBe(true);

    // 3 sablon-fázis + 1 fog-fázis = 4 audit sor, egy tranzakcióból (a
    // created_at azonos, ezért change_type szerint válogatunk, nem sorrendre).
    const rows = await auditRows(episode.id);
    expect(rows).toHaveLength(4);

    const applyRows = rows.filter((r) => r.change_type === 'template_apply');
    expect(applyRows).toHaveLength(3);
    expect(applyRows.map((r) => r.work_phase_code).sort()).toEqual(
      ['atadas', 'konzultacio', 'lenyomat'].sort()
    );
    for (const row of applyRows) {
      expect(row.episode_work_phase_id).not.toBeNull();
      expect(row.old_status).toBeNull();
      expect(row.new_status).toBe('pending');
      expect(row.changed_by).toBe(doctor.email);
      expect(row.reason).toContain('WP-2.1 fog-sablon');
    }

    const createRows = rows.filter((r) => r.change_type === 'create');
    expect(createRows).toHaveLength(1);
    const toothRow = createRows[0];
    expect(toothRow.episode_work_phase_id).not.toBeNull();
    expect(toothRow.work_phase_code).toBe(`tooth_${catalog.code}`);
    expect(toothRow.custom_label).toBe(`${catalog.labelHu} – 21`);
    expect(toothRow.old_status).toBeNull();
    expect(toothRow.new_status).toBe('pending');
    expect(toothRow.changed_by).toBe(doctor.email);
    expect(toothRow.reason).toContain('Fogkezelésből hozzáadva');
  });
});
