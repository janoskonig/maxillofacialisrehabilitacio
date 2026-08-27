import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestUser,
  createTestWorkPhase,
} from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { POST as batchValidate } from '@/app/api/episodes/plan-validation/batch/route';
import { GET as getValidation, POST as approvePlan } from '@/app/api/episodes/[id]/plan-validation/route';

/**
 * WP-1.1 (zajcsökkentés): a kivezetett warning-szabályok (ismételt fázis,
 * kontroll munkafázis előtt, hiányzó konzultáció, üres terv, hosszú időtartam)
 * route-szinten sem termelnek riasztást; a két strukturális error
 * (INVALID_POOL, INVALID_DURATION) továbbra is él és blokkolja a jóváhagyást.
 * Az üres terv a batch-ben `status: null` — a listák nem mutatnak rá badge-et.
 *
 * Route-handlereket hívunk (a route maga COMMIT-ol), ezért a factory-k
 * pool-lal futnak és afterEach takarít.
 */

afterEach(cleanupCreated);

async function makeDoctor(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

async function makeEpisode(): Promise<{ episodeId: string }> {
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  return { episodeId: episode.id };
}

async function callBatch(episodeIds: string[], user: TestAuthUser) {
  const req = await authedRequest('http://test.local/api/episodes/plan-validation/batch', {
    user,
    method: 'POST',
    body: { episodeIds },
  });
  const res = await batchValidate(req);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<
    string,
    { status: string | null; errorCount: number; approved: boolean; sequenceViolations: number }
  >;
}

async function callGet(episodeId: string, user: TestAuthUser) {
  const req = await authedRequest(`http://test.local/api/episodes/${episodeId}/plan-validation`, {
    user,
  });
  const res = await getValidation(req, { params: { id: episodeId } });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    issues: Array<{ level: string; code: string }>;
    approvable: boolean;
  };
}

describe('plan-validation zajcsökkentés (WP-1.1)', () => {
  it('ismételt fázis + kontroll elöl + nincs konzultáció + hosszú időtartam → nincs riasztás, a terv "ready"', async () => {
    const doctor = await makeDoctor();
    const { episodeId } = await makeEpisode();
    // Szándékosan minden korábbi warning-mintát felhalmozunk:
    await createTestWorkPhase(undefined, episodeId, {
      workPhaseCode: 'kontroll',
      pool: 'control',
      seq: 0,
    }); // kontroll az első munkafázis előtt
    await createTestWorkPhase(undefined, episodeId, {
      workPhaseCode: 'lenyomat',
      pool: 'work',
      seq: 1,
    });
    await createTestWorkPhase(undefined, episodeId, {
      workPhaseCode: 'lenyomat',
      pool: 'work',
      seq: 2,
    }); // ugyanaz a fázis kétszer = több alkalom (kétállcsontos eset)
    await createTestWorkPhase(undefined, episodeId, {
      workPhaseCode: 'hosszu_munka',
      pool: 'work',
      seq: 3,
      durationMinutes: 600,
    }); // hosszú időtartam — csak a szerkesztő sor inline hintje, nem issue

    const single = await callGet(episodeId, doctor);
    expect(single.issues).toEqual([]);
    expect(single.approvable).toBe(true);

    const batch = await callBatch([episodeId], doctor);
    expect(batch[episodeId].status).toBe('ready');
    expect(batch[episodeId].errorCount).toBe(0);
  });

  it('strukturális hiba (érvénytelen pool/időtartam) továbbra is error, és blokkolja a jóváhagyást', async () => {
    const doctor = await makeDoctor();
    const { episodeId } = await makeEpisode();
    const phase = await createTestWorkPhase(undefined, episodeId, {
      workPhaseCode: 'serult',
      pool: 'work',
      seq: 0,
    });
    // A factory típusa csak érvényes poolt enged — a hibás állapotot SQL-lel állítjuk elő.
    await getDbPool().query(
      `UPDATE episode_work_phases SET pool = 'nonsense', duration_minutes = 0 WHERE id = $1`,
      [phase.id]
    );

    const single = await callGet(episodeId, doctor);
    const codes = single.issues.map((i) => i.code);
    expect(codes).toContain('INVALID_POOL');
    expect(codes).toContain('INVALID_DURATION');
    expect(single.issues.every((i) => i.level === 'error')).toBe(true);
    expect(single.approvable).toBe(false);

    const batch = await callBatch([episodeId], doctor);
    expect(batch[episodeId].status).toBe('errors');
    expect(batch[episodeId].errorCount).toBeGreaterThan(0);

    // A jóváhagyás visszautasítása (409) — a két error tényleg kapu a jóváhagyásra.
    const approveReq = await authedRequest(
      `http://test.local/api/episodes/${episodeId}/plan-validation`,
      { user: doctor, method: 'POST' }
    );
    const approveRes = await approvePlan(approveReq, { params: { id: episodeId } });
    expect(approveRes.status).toBe(409);
  });

  it('üres terv és csupa-kihagyott terv → status: null (nincs badge)', async () => {
    const doctor = await makeDoctor();
    const { episodeId: emptyEpisode } = await makeEpisode();
    const { episodeId: skippedEpisode } = await makeEpisode();
    await createTestWorkPhase(undefined, skippedEpisode, {
      workPhaseCode: 'lenyomat',
      pool: 'work',
      seq: 0,
      status: 'skipped',
    });

    const batch = await callBatch([emptyEpisode, skippedEpisode], doctor);
    expect(batch[emptyEpisode].status).toBeNull();
    expect(batch[skippedEpisode].status).toBeNull();
  });

  it('jóváhagyott, tiszta terv → "approved"', async () => {
    const doctor = await makeDoctor();
    const { episodeId } = await makeEpisode();
    await createTestWorkPhase(undefined, episodeId, {
      workPhaseCode: 'lenyomat',
      pool: 'work',
      seq: 0,
    });
    await getDbPool().query(
      `UPDATE patient_episodes SET plan_approved_at = NOW(), plan_approved_by = $2 WHERE id = $1`,
      [episodeId, doctor.id]
    );

    const batch = await callBatch([episodeId], doctor);
    expect(batch[episodeId].status).toBe('approved');
    expect(batch[episodeId].approved).toBe(true);
  });
});
