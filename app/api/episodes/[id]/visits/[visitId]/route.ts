import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { cancelAppointmentRelease } from '@/lib/work-phase-delete';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { hasVisitAppointmentColumn } from '@/lib/visit-appointment-sync';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/**
 * PATCH /api/episodes/:id/visits/:visitId — alkalom metaadatai.
 * Body: { label?, daysOffset?, plannedDurationMinutes? } — csak a megadott
 * mezők változnak; null = mező törlése (ahol értelmes).
 */
export const PATCH = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const visitId = params.visitId;
  const body = await req.json().catch(() => ({}));
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'JSON objektum body szükséges' }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query(
      `SELECT v.id, v.label, v.days_offset, v.planned_duration_minutes,
              pe.status AS episode_status
       FROM episode_visits v
       JOIN patient_episodes pe ON pe.id = v.episode_id
       WHERE v.id = $1 AND v.episode_id = $2
       FOR UPDATE OF v FOR SHARE OF pe`,
      [visitId, episodeId]
    );
    if (row.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Alkalom nem található' }, { status: 404 });
    }
    if (row.rows[0].episode_status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Lezárt epizód alkalmai nem módosíthatók', code: 'EPISODE_NOT_OPEN' },
        { status: 409 }
      );
    }
    const visit = row.rows[0];

    const sets: string[] = [];
    const vals: unknown[] = [];
    const auditChanges: string[] = [];
    let pi = 1;

    if ('label' in body) {
      const newLabel =
        typeof body.label === 'string' ? body.label.trim().slice(0, 200) || null : null;
      sets.push(`label = $${pi++}`);
      vals.push(newLabel);
      if (newLabel !== (visit.label ?? null)) {
        auditChanges.push(`címke „${visit.label ?? '—'}” → „${newLabel ?? '—'}”`);
      }
    }
    if ('daysOffset' in body) {
      const v = body.daysOffset;
      if (v != null && (!Number.isInteger(v) || v < 0)) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'A daysOffset nem-negatív egész nap legyen' },
          { status: 400 }
        );
      }
      sets.push(`days_offset = $${pi++}`);
      vals.push(v ?? null);
      if ((v ?? null) !== (visit.days_offset ?? null)) {
        auditChanges.push(`eltolás ${visit.days_offset ?? '—'}→${v ?? '—'} nap`);
      }
    }
    if ('plannedDurationMinutes' in body) {
      const v = body.plannedDurationMinutes;
      if (v != null && (!Number.isInteger(v) || v <= 0)) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'A plannedDurationMinutes pozitív egész perc legyen' },
          { status: 400 }
        );
      }
      sets.push(`planned_duration_minutes = $${pi++}`);
      vals.push(v ?? null);
      if ((v ?? null) !== (visit.planned_duration_minutes ?? null)) {
        auditChanges.push(`tervezett hossz ${visit.planned_duration_minutes ?? '—'}→${v ?? '—'} perc`);
      }
    }

    if (sets.length > 0) {
      vals.push(visitId);
      await client.query(
        `UPDATE episode_visits SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${pi}`,
        vals
      );
    }

    if (auditChanges.length > 0) {
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: null,
        episodeId,
        oldStatus: null,
        newStatus: null,
        changedBy: auth.email ?? auth.userId ?? 'unknown',
        changeType: 'visit_change',
        reason: `Alkalom módosítva: ${auditChanges.join(', ')}`,
      });
    }

    await client.query('COMMIT');

    if (auditChanges.length > 0) {
      try {
        await emitSchedulingEvent('episode', episodeId, 'visit_updated');
      } catch {
        /* non-blocking */
      }
    }

    const updated = await pool.query(
      `SELECT id, seq, label, days_offset AS "daysOffset",
              planned_duration_minutes AS "plannedDurationMinutes"
       FROM episode_visits WHERE id = $1`,
      [visitId]
    );
    return NextResponse.json({ visit: updated.rows[0] ?? null });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/episodes/:id/visits/:visitId — csak ÜRES alkalom törölhető.
 * Nem-üresre 409: a fázisok előbb áthelyezhetők másik alkalomba (ajánlat,
 * nem tiltás — a művelet a fázisok mozgatása után megismételhető).
 *
 * Puzzle v2 (094): az alkalom birtokolja az időpontját — üres, de foglalt
 * alkalom törlésekor a nyitott foglalást LEMONDJUK (slot szabad, intent
 * lejár). Lezárt (completed) foglalás a történetben marad, csak leválik.
 */
export const DELETE = roleHandler([...ROLES], async (req, { auth, params }) => {
  const episodeId = params.id;
  const visitId = params.visitId;
  const pool = getDbPool();
  const client = await pool.connect();
  let cancelledAppointment = false;
  try {
    await client.query('BEGIN');
    // 094 előtti sémán (deploy migráció előtt) nincs vizit-időpont oszlop.
    const hasVisitAppt = await hasVisitAppointmentColumn(client);
    const row = await client.query(
      hasVisitAppt
        ? `SELECT v.id, v.label, v.appointment_id, pe.status AS episode_status,
                  (SELECT COUNT(*)::int FROM episode_work_phases e WHERE e.visit_id = v.id) AS phase_count,
                  a.appointment_status, a.time_slot_id, a.slot_intent_id
           FROM episode_visits v
           JOIN patient_episodes pe ON pe.id = v.episode_id
           LEFT JOIN appointments a ON a.id = v.appointment_id
           WHERE v.id = $1 AND v.episode_id = $2
           FOR UPDATE OF v FOR SHARE OF pe`
        : `SELECT v.id, v.label, NULL::uuid AS appointment_id, pe.status AS episode_status,
                  (SELECT COUNT(*)::int FROM episode_work_phases e WHERE e.visit_id = v.id) AS phase_count,
                  NULL::text AS appointment_status, NULL::uuid AS time_slot_id, NULL::uuid AS slot_intent_id
           FROM episode_visits v
           JOIN patient_episodes pe ON pe.id = v.episode_id
           WHERE v.id = $1 AND v.episode_id = $2
           FOR UPDATE OF v FOR SHARE OF pe`,
      [visitId, episodeId]
    );
    if (row.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Alkalom nem található' }, { status: 404 });
    }
    if (row.rows[0].episode_status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Lezárt epizód alkalmai nem módosíthatók', code: 'EPISODE_NOT_OPEN' },
        { status: 409 }
      );
    }
    if (Number(row.rows[0].phase_count) > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error:
            'Az alkalomhoz munkafázisok tartoznak — helyezze át őket másik alkalomba, utána az üres alkalom törölhető',
          code: 'VISIT_NOT_EMPTY',
        },
        { status: 409 }
      );
    }

    // Az alkalom nyitott foglalása vele megy (lemondás); a lezárt marad a történetben.
    const visit = row.rows[0] as {
      appointment_id: string | null;
      appointment_status: string | null;
      time_slot_id: string | null;
      slot_intent_id: string | null;
    };
    if (visit.appointment_id && visit.appointment_status == null) {
      await cancelAppointmentRelease(client, {
        id: visit.appointment_id,
        time_slot_id: visit.time_slot_id,
        slot_intent_id: visit.slot_intent_id,
      });
      cancelledAppointment = true;
    }

    // Az atomi, feltételes DELETE zárja a TOCTOU-ablakot (a FOR UPDATE mellett
    // párhuzamos fázis-áthelyezés ide már nem tud beékelődni, de olcsó őr).
    const deleted = await client.query(
      `DELETE FROM episode_visits v
       WHERE v.id = $1
         AND NOT EXISTS (SELECT 1 FROM episode_work_phases e WHERE e.visit_id = v.id)
       RETURNING id`,
      [visitId]
    );
    if ((deleted.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Az alkalom időközben megváltozott — frissítse a listát', code: 'VISIT_CHANGED' },
        { status: 409 }
      );
    }

    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: null,
      episodeId,
      oldStatus: null,
      newStatus: null,
      changedBy: auth.email ?? auth.userId ?? 'unknown',
      changeType: 'visit_change',
      reason: `Üres alkalom törölve${row.rows[0].label ? ` („${row.rows[0].label}”)` : ''}${
        cancelledAppointment ? ' (az időpontja lemondva)' : ''
      }`,
    });

    await client.query('COMMIT');

    if (cancelledAppointment) {
      try {
        await projectRemainingSteps(episodeId);
      } catch {
        /* non-blocking */
      }
    }
    try {
      await emitSchedulingEvent('episode', episodeId, 'visit_deleted');
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ ok: true, cancelledAppointment });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
