import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { syncVisitAppointment } from '@/lib/visit-appointment-sync';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/**
 * POST /api/episodes/:id/visits/:visitId/prepare-booking
 *
 * Egy alkalom = EGY időpont. Az alkalom nyitott fázisai egy blokk: a
 * sorrendben első a primary (ő hordozza a foglalást a régi motorok felé), a
 * többi alá vonva. A puzzle v2 (094) óta ezt minden kompozíciós mutáció
 * maga tartja karban (syncVisitAppointment); ez a végpont ugyanazt futtatja
 * idempotensen, és visszaadja a primary fázist a foglaláshoz.
 *
 * A blokk hossza NEM íródik a primary sorra: a worklist / projektor / slot-
 * választó az alkalom nyitott tagjainak összpercét (vagy a tervezett hosszt)
 * használja olvasáskor.
 *
 * Válasz: { primaryWorkPhaseId, mergedCount, durationMinutes }.
 * Nincs nyitott fázis → 409 VISIT_NOT_BOOKABLE.
 */
export const POST = roleHandler([...ROLES], async (_req, { auth, params }) => {
  const episodeId = params.id;
  const visitId = params.visitId;
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gate = await client.query(
      `SELECT pe.status AS episode_status FROM episode_visits v
       JOIN patient_episodes pe ON pe.id = v.episode_id
       WHERE v.id = $1 AND v.episode_id = $2 FOR SHARE OF pe`,
      [visitId, episodeId]
    );
    if (gate.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Alkalom nem található' }, { status: 404 });
    }
    if (gate.rows[0].episode_status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Lezárt epizód alkalmai nem módosíthatók', code: 'EPISODE_NOT_OPEN' },
        { status: 409 }
      );
    }

    const sync = await syncVisitAppointment(client, episodeId, visitId, auth.email ?? auth.userId ?? 'unknown');
    if (!sync || !sync.primaryId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Az alkalomban nincs foglalható (nyitott) munkafázis', code: 'VISIT_NOT_BOOKABLE' },
        { status: 409 }
      );
    }
    await client.query('COMMIT');

    if (sync.mergedCount > 0) {
      try {
        await projectRemainingSteps(episodeId);
      } catch {
        /* non-blocking */
      }
      try {
        await emitSchedulingEvent('episode', episodeId, 'steps_merged');
      } catch {
        /* non-blocking */
      }
    }

    return NextResponse.json({
      primaryWorkPhaseId: sync.primaryId,
      mergedCount: sync.mergedCount,
      durationMinutes: sync.durationMinutes ?? 30,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
