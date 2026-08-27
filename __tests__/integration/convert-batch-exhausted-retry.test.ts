/**
 * WP-0.8 / audit #09 — viselkedési integrációs tesztek.
 *
 * (a) Kimerült retry: a `convertIntentToAppointment` zárolási ütközésnél
 *     (40001/40P01) korábban a 3. próbálkozás után TOVÁBBDOBTA a hibát — a
 *     ciklus utáni `return { status: 503 }` halott kód volt. Most a kimerült
 *     retry a 503-as ágra esik (nem dob).
 * (b) Köteg-robusztusság: ha egy intent konverziója dob, a
 *     `convert-all-intents` route nem 500-zal hal el (ami a már COMMIT-olt
 *     foglalásokat is eltitkolná), hanem skipped[] bejegyzést ír és a többi
 *     eredményt visszaadja.
 *
 * A (b) teszthez a konverziós hibát a collaborator-határon injektáljuk
 * (vi.mock, alapból az eredeti implementációra delegál) — a route ciklusa, a
 * DB-írások és a válasz-alak valósak.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';
import type { AuthPayload } from '@/lib/auth-server';
import { POST as convertAllIntentsPost } from '@/app/api/episodes/[id]/convert-all-intents/route';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestSlot,
  createTestSlotIntent,
  createTestUser,
  createTestWorkPhase,
} from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const convertControl = vi.hoisted(() => ({
  failForIntentId: null as string | null,
}));

vi.mock('@/lib/convert-slot-intent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/convert-slot-intent')>();
  return {
    ...actual,
    convertIntentToAppointment: (
      ...args: Parameters<typeof actual.convertIntentToAppointment>
    ) => {
      if (convertControl.failForIntentId === args[1]) {
        throw new Error('szimulált konverziós hiba (teszt)');
      }
      return actual.convertIntentToAppointment(...args);
    },
  };
});

/** A route által (nem factory-n át) létrehozott sorok takarításához. */
const createdEpisodeIds: string[] = [];

afterEach(async () => {
  convertControl.failForIntentId = null;
  const pool = getDbPool();
  if (createdEpisodeIds.length > 0) {
    await pool.query(`DELETE FROM appointments WHERE episode_id = ANY($1::uuid[])`, [
      createdEpisodeIds,
    ]);
    await pool.query(`DELETE FROM scheduling_events WHERE entity_id = ANY($1::uuid[])`, [
      createdEpisodeIds,
    ]);
    createdEpisodeIds.length = 0;
  }
  await cleanupCreated();
});

async function authUser(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

describe('WP-0.8 / #09a — kimerült retry a 503-as ágra esik (nem dob)', () => {
  it('3 zárolási ütközés után { ok:false, status:503 } a válasz', async () => {
    const { convertIntentToAppointment: actualConvert } = await vi.importActual<
      typeof import('@/lib/convert-slot-intent')
    >('@/lib/convert-slot-intent');

    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'pending',
    });
    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      workPhaseId: ewp.id,
    });

    // Facade pool: az intent-SELECT a valódi poolon fut, de minden tranzakciós
    // kapcsolat BEGIN-je determinisztikus 40001-gyel (serialization failure)
    // hasal el — pontosan a retriable zárolási ütközés alakja.
    const realPool = getDbPool();
    let connectCount = 0;
    const lockErrorPool = {
      query: (...args: unknown[]) =>
        (realPool.query as (...a: unknown[]) => unknown)(...args),
      connect: async () => {
        connectCount++;
        return {
          query: async (sql: string) => {
            if (typeof sql === 'string' && sql.startsWith('BEGIN')) {
              const err = new Error('could not serialize access due to concurrent update');
              (err as Error & { code: string }).code = '40001';
              throw err;
            }
            return { rows: [], rowCount: 0 };
          },
          release: () => {},
        };
      },
    } as unknown as Pool;

    const auth: AuthPayload = {
      userId: user.id,
      email: user.email,
      role: 'fogpótlástanász',
    } as AuthPayload;

    // Korábban ez throw-olt (a 40001 a 3. próbálkozás után továbbdobódott);
    // most a 503-as ág fut.
    const result = await actualConvert(lockErrorPool, intent.id, auth, {
      skipOneHardNext: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.error).toContain('többszöri próbálkozás');
    }
    // Tényleg volt retry: 3 tranzakciós próbálkozás történt.
    expect(connectCount).toBe(3);
  });
});

describe('WP-0.8 / #09b — a köteg nem titkolja el a már COMMIT-olt foglalásokat', () => {
  it('dobott konverziós hiba skipped[] bejegyzés lesz, a többi foglalás látszik', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    const ewpA = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'pending',
    });
    const ewpB = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'harapasregisztracio',
      seq: 1,
      status: 'pending',
    });

    const intentA = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      workPhaseId: ewpA.id,
    });
    const intentB = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'harapasregisztracio',
      stepSeq: 1,
      workPhaseId: ewpB.id,
    });

    // Szabad work slot az 1. intentnek; a 2. intent konverziója dob.
    const slot = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
    });
    convertControl.failForIntentId = intentB.id;

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/convert-all-intents`,
      { user, method: 'POST' }
    );
    const res = await convertAllIntentsPost(req, { params: { id: episode.id } });

    // Nem 500: a válasz a részleges eredményt hordozza.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.converted).toBe(1);
    expect(body.appointmentIds).toHaveLength(1);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].intentId).toBe(intentB.id);
    expect(body.skipped[0].code).toBe('CONVERT_FAILED');
    expect(body.skipped[0].reason).toContain('szimulált konverziós hiba');

    // Az 1. foglalás tényleg COMMIT-olt és látható.
    const appt = await pool.query(
      `SELECT id, time_slot_id FROM appointments WHERE id = $1`,
      [body.appointmentIds[0]]
    );
    expect(appt.rows).toHaveLength(1);
    expect(appt.rows[0].time_slot_id).toBe(slot.id);
    const intentAAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intentA.id,
    ]);
    expect(intentAAfter.rows[0].state).toBe('converted');
    // A dobó intent érintetlen (nem konvertálódott, nem járt le).
    const intentBAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intentB.id,
    ]);
    expect(intentBAfter.rows[0].state).toBe('open');
  });
});
