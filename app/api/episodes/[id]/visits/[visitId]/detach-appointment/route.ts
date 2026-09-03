import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { listEpisodeVisits } from '@/lib/episode-visits';
import {
  normalizeVisitOrder,
  hasVisitAppointmentColumn,
  hasVisitDetachedColumn,
} from '@/lib/visit-appointment-sync';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/**
 * POST /api/episodes/:id/visits/:visitId/detach-appointment
 *
 * Az alkalom időpontjának leválasztása LEMONDÁS NÉLKÜL: a foglalás megmarad
 * alkalom nélküli időpontként (a vázhoz később újra hozzárendelhető), az
 * alkalom tartalma várakozóvá válik. Lezárt (completed) foglalás nem
 * választható le (történet).
 */
export const POST = roleHandler([...ROLES], async (_req, { auth, params }) => {
  const episodeId = params.id;
  const visitId = params.visitId;
  const pool = getDbPool();
  // 094 előtti sémán a vizit-tulajdonú időpont nem elérhető — a migráció hiányát
  // jelezzük (nem generikus 500).
  if (!(await hasVisitAppointmentColumn(pool))) {
    return NextResponse.json(
      { error: 'A vizit-időpont funkcióhoz a 094-es migráció szükséges (npm run migrate)', code: 'MIGRATION_PENDING' },
      { status: 503 }
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const visitRow = await client.query(
      `SELECT v.id, v.appointment_id, pe.status AS episode_status, a.appointment_status
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
    if (!visit.appointment_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Az alkalomnak nincs időpontja', code: 'NO_APPOINTMENT' }, { status: 409 });
    }
    if (visit.appointment_status != null) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Lezárt foglalás nem választható le (történet)', code: 'APPOINTMENT_NOT_OPEN' },
        { status: 409 }
      );
    }
    const changedBy = auth.email ?? auth.userId ?? 'unknown';
    const appointmentId = visit.appointment_id as string;

    // A fázis-szintű link is elengedve: a tartalom várakozó lesz.
    const linked = await client.query(
      `UPDATE episode_work_phases
       SET appointment_id = NULL,
           status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
       WHERE visit_id = $1 AND appointment_id = $2
       RETURNING id, status`,
      [visitId, appointmentId]
    );
    for (const r of linked.rows as Array<{ id: string; status: string }>) {
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: r.id,
        episodeId,
        oldStatus: 'scheduled',
        newStatus: 'pending',
        changedBy,
        reason: 'Az alkalom időpontja leválasztva (a foglalás alkalom nélkül marad)',
      });
    }
    await client.query(`UPDATE appointments SET work_phase_id = NULL WHERE id = $1`, [appointmentId]);
    // WP-6.5: a kézi leválasztás jelölője — az automatikus rácsúszás ezt az
    // időpontot kihagyja (különben a következő olvasás visszatenné); a kézi
    // hozzárendelés (attach) törli.
    if (await hasVisitDetachedColumn(client)) {
      await client.query(`UPDATE appointments SET visit_detached_at = CURRENT_TIMESTAMP WHERE id = $1`, [
        appointmentId,
      ]);
    }
    await client.query(
      `UPDATE episode_visits SET appointment_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [visitId]
    );
    await normalizeVisitOrder(client, episodeId);
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: null,
      episodeId,
      oldStatus: null,
      newStatus: null,
      changedBy,
      changeType: 'visit_change',
      reason: `Időpont leválasztva az alkalomról (${appointmentId.slice(0, 8)}) — a foglalás megmaradt`,
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
    return NextResponse.json({ visits });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
