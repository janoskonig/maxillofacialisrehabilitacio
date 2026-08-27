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
  cleanupCreatedWp03,
  createTestCarePathway,
  createTestEpisodePathway,
  createTestTreatmentType,
  createTestWorkPhaseFromPathway,
} from './helpers/factories-wp03';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { DELETE as deleteWorkPhase } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';
import { PATCH as patchEpisode } from '@/app/api/episodes/[id]/route';

/**
 * WP-0.3 (kódaudit #12): a munkafázis törlése ne törölje a fázis auditját.
 *
 * A 084-es migráció előtt az episode_work_phase_audit.episode_work_phase_id
 * FK ON DELETE CASCADE volt — a DELETE tranzakciója a frissen beírt
 * new_status='deleted' sort ÉS a fázis teljes előzményét is elvitte.
 * Ezek a tesztek route-handlereket hívnak (a route maga COMMIT-ol), ezért
 * a factory-k pool-lal futnak és afterEach takarít.
 */

afterEach(async () => {
  await cleanupCreatedWp03();
  await cleanupCreated();
});

async function makeDoctor(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

describe('munkafázis-audit tombstone (WP-0.3)', () => {
  it('fázis törlése után az audit sor megmarad, episode_work_phase_id IS NULL és a snapshot kitöltött', async () => {
    const pool = getDbPool();
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const wp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      pool: 'work',
      durationMinutes: 45,
      customLabel: 'Felső lenyomat',
    });

    // A fázis "előzménye": egy korábbi audit bejegyzés — a tombstone-nak
    // ezt is túl kell élnie (a régi CASCADE ezt is törölte).
    await insertWorkPhaseAudit(pool, {
      episodeWorkPhaseId: wp.id,
      episodeId: episode.id,
      oldStatus: 'pending',
      newStatus: 'scheduled',
      changedBy: doctor.email,
      reason: 'integrációs teszt — korábbi státuszváltás',
    });

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${wp.id}`,
      { user: doctor, method: 'DELETE' }
    );
    const res = await deleteWorkPhase(req, {
      params: { id: episode.id, workPhaseId: wp.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    // A fázis tényleg törlődött...
    const ewpAfter = await pool.query(`SELECT 1 FROM episode_work_phases WHERE id = $1`, [wp.id]);
    expect(ewpAfter.rows).toHaveLength(0);

    // ...de az audit előzmény ÉS a 'deleted' tombstone sor is megmaradt.
    const audit = await pool.query(
      `SELECT episode_work_phase_id, old_status, new_status, work_phase_code,
              custom_label, pool, duration_minutes
         FROM episode_work_phase_audit
        WHERE episode_id = $1
        ORDER BY created_at`,
      [episode.id]
    );
    expect(audit.rows).toHaveLength(2);
    for (const row of audit.rows) {
      // FK ON DELETE SET NULL: a hivatkozás elengedve, a snapshot olvasható.
      expect(row.episode_work_phase_id).toBeNull();
      expect(row.work_phase_code).toBe('lenyomat');
      expect(row.custom_label).toBe('Felső lenyomat');
      expect(row.pool).toBe('work');
      expect(row.duration_minutes).toBe(45);
    }
    expect(audit.rows[0].new_status).toBe('scheduled');
    expect(audit.rows[1].new_status).toBe('deleted');
    expect(audit.rows[1].old_status).toBe('pending');
  });

  it('sablon force-eltávolítása N fázisra N tombstone audit sort ír', async () => {
    const pool = getDbPool();
    const doctor = await makeDoctor();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const treatmentType = await createTestTreatmentType();
    const carePathway = await createTestCarePathway(undefined, treatmentType.id);
    const episodePathway = await createTestEpisodePathway(undefined, episode.id, carePathway.id);

    const codes = ['konzultacio', 'lenyomat', 'atadas'] as const;
    const phases = [] as Array<{ id: string }>;
    for (let i = 0; i < codes.length; i++) {
      phases.push(
        await createTestWorkPhaseFromPathway(undefined, episode.id, episodePathway.id, {
          workPhaseCode: codes[i],
          seq: i,
          // Egy foglaltnak jelölt fázis, hogy a force-megerősítés kelljen.
          status: i === 1 ? 'scheduled' : 'pending',
        })
      );
    }

    // Force nélkül 409 — a sablonnak van foglalt fázisa.
    const reqNoForce = await authedRequest(`http://test.local/api/episodes/${episode.id}`, {
      user: doctor,
      method: 'PATCH',
      body: { action: 'removePathway', episodePathwayId: episodePathway.id },
    });
    const resNoForce = await patchEpisode(reqNoForce, { params: { id: episode.id } });
    expect(resNoForce.status).toBe(409);
    expect((await resNoForce.json()).code).toBe('PATHWAY_HAS_ACTIVE_PHASES');

    // Force-szal megy, és fázisonként ír tombstone audit sort.
    const reqForce = await authedRequest(`http://test.local/api/episodes/${episode.id}`, {
      user: doctor,
      method: 'PATCH',
      body: { action: 'removePathway', episodePathwayId: episodePathway.id, force: true },
    });
    const resForce = await patchEpisode(reqForce, { params: { id: episode.id } });
    expect(resForce.status).toBe(200);
    const forceBody = await resForce.json();
    expect(forceBody.removed).toBe(true);
    expect(forceBody.removedPhaseCount).toBe(3);

    const ewpAfter = await pool.query(
      `SELECT 1 FROM episode_work_phases WHERE episode_id = $1`,
      [episode.id]
    );
    expect(ewpAfter.rows).toHaveLength(0);

    const audit = await pool.query(
      `SELECT episode_work_phase_id, old_status, new_status, work_phase_code, changed_by, reason
         FROM episode_work_phase_audit
        WHERE episode_id = $1 AND new_status = 'deleted'
        ORDER BY work_phase_code`,
      [episode.id]
    );
    expect(audit.rows).toHaveLength(3);
    expect(audit.rows.map((r: any) => r.work_phase_code).sort()).toEqual(
      [...codes].sort()
    );
    for (const row of audit.rows) {
      expect(row.episode_work_phase_id).toBeNull();
      expect(row.changed_by).toBe(doctor.email);
      expect(row.reason).toContain('force');
    }
    const scheduledRow = audit.rows.find((r: any) => r.work_phase_code === 'lenyomat');
    expect(scheduledRow.old_status).toBe('scheduled');
  });
});
