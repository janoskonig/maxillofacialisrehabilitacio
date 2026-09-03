import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { listEpisodeVisits } from '@/lib/episode-visits';
import { normalizeVisitOrder, syncVisitAppointment } from '@/lib/visit-appointment-sync';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/**
 * POST /api/episodes/:id/visits/:visitId/attach-appointment
 * Body: { appointmentId }
 *
 * „Az időpontfoglalás a váz": egy meglévő, nyitott foglalás (a beteg alkalom
 * nélkül maradt / portálon foglalt időpontja) hozzárendelése az alkalomhoz.
 * Az alkalom nyitott tartalma a foglalásra csúszik (a primary fázis
 * scheduled lesz), a foglalt alkalmak időrendje igazodik. Üres alkalomra is
 * tehető: „időpont tartalom nélkül".
 */
export const POST = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const visitId = params.visitId;
  const body = await req.json().catch(() => ({}));
  const appointmentId = body?.appointmentId;
  if (typeof appointmentId !== 'string' || !appointmentId) {
    return NextResponse.json({ error: 'appointmentId kötelező' }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const visitRow = await client.query(
      `SELECT v.id, v.appointment_id, pe.status AS episode_status, pe.patient_id,
              a.appointment_status AS current_status
       FROM episode_visits v
       JOIN patient_episodes pe ON pe.id = v.episode_id
       LEFT JOIN appointments a ON a.id = v.appointment_id
       WHERE v.id = $1 AND v.episode_id = $2
       FOR UPDATE OF v FOR SHARE OF pe`,
      [visitId, episodeId]
    );
    if (visitRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Alkalom nem található' }, { status: 404 });
    }
    const visit = visitRow.rows[0];
    if (visit.episode_status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Lezárt epizód alkalmai nem módosíthatók', code: 'EPISODE_NOT_OPEN' },
        { status: 409 }
      );
    }
    if (visit.appointment_id && visit.appointment_id !== appointmentId && visit.current_status == null) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Az alkalomnak már van nyitott időpontja — előbb válassza le', code: 'VISIT_HAS_APPOINTMENT' },
        { status: 409 }
      );
    }

    const apptRow = await client.query(
      `SELECT a.id, a.patient_id, a.episode_id, a.appointment_status,
              (SELECT v2.id FROM episode_visits v2 WHERE v2.appointment_id = a.id AND v2.id <> $2 LIMIT 1) AS other_visit_id
       FROM appointments a WHERE a.id = $1 FOR UPDATE OF a`,
      [appointmentId, visitId]
    );
    if (apptRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Foglalás nem található' }, { status: 404 });
    }
    const appt = apptRow.rows[0];
    if (appt.patient_id !== visit.patient_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'A foglalás nem ehhez a beteghez tartozik' }, { status: 400 });
    }
    if (appt.episode_id && appt.episode_id !== episodeId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'A foglalás másik epizódhoz tartozik' }, { status: 400 });
    }
    if (appt.appointment_status != null) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Csak nyitott (nem lezárt / lemondott) foglalás rendelhető alkalomhoz', code: 'APPOINTMENT_NOT_OPEN' },
        { status: 400 }
      );
    }
    if (appt.other_visit_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'A foglalás már egy másik alkalomhoz tartozik — ott válassza le előbb', code: 'APPOINTMENT_ATTACHED' },
        { status: 409 }
      );
    }

    await client.query(
      `UPDATE episode_visits SET appointment_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [appointmentId, visitId]
    );
    await client.query(`UPDATE appointments SET episode_id = $1 WHERE id = $2 AND episode_id IS NULL`, [
      episodeId,
      appointmentId,
    ]);
    const changedBy = auth.email ?? auth.userId ?? 'unknown';
    const sync = await syncVisitAppointment(client, episodeId, visitId, changedBy);
    await normalizeVisitOrder(client, episodeId);
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: sync?.primaryId ?? null,
      episodeId,
      oldStatus: null,
      newStatus: null,
      changedBy,
      changeType: 'visit_change',
      reason: `Időpont az alkalomhoz rendelve (${appointmentId.slice(0, 8)})`,
    });
    const visits = await listEpisodeVisits(client, episodeId);
    await client.query('COMMIT');

    try {
      await projectRemainingSteps(episodeId);
    } catch {
      /* non-blocking */
    }
    try {
      await emitSchedulingEvent('episode', episodeId, 'visit_updated');
    } catch {
      /* non-blocking */
    }
    return NextResponse.json({ visits, primaryWorkPhaseId: sync?.primaryId ?? null });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
