import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { logActivity } from '@/lib/activity';
import { isAppointmentType } from '@/lib/appointment-constants';
import { translateUniqueViolation } from '@/lib/appointment-constraint-errors';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import {
  findEwpForAppointmentRevert,
  revertWorkPhaseLinkToPending,
} from '@/lib/episode-work-phase-revert-lookup';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { adoptAppointmentForPhaseVisit } from '@/lib/visit-appointment-sync';
import { releaseGoogleCalendarEventForCancelledSlot } from '@/lib/appointment-calendar-release';
import { purgeCancelledAppointmentsOnSlot } from '@/lib/appointment-slot-release';
import {
  sendAppointmentCancellationNotification,
  sendCancellationWithNewOfferToPatient,
  sendConditionalAppointmentNotificationToAdmin,
} from '@/lib/email';

/**
 * POST /api/appointments/[id]/cancel-and-offer
 *
 * „Lemondás és új időpont ajánlása": a meglévő foglalás lemondása ÉS egy
 * feltételes (jóváhagyásra váró) időpont-ajánlat kiküldése a betegnek EGY
 * lépésben, egy tranzakcióban, egy levélben.
 *
 *  - A régi foglalás a kanonikus lemondási mintát követi (mint a
 *    PATCH /status cancelled_by_doctor): státusz, slot felszabadul, konvertált
 *    intent lejár, a munkafázis-kötés visszanyílik.
 *  - Az új ajánlat a POST /api/appointments/pending sorát követi
 *    (approval_status='pending' + token, Elfogadom / Elvetem linkek), de
 *    ÖRÖKLI a régi foglalás epizód/munkafázis/pool/típus kontextusát, és a
 *    munkafázis-kötést is átveszi — így a tervben a fázis nem esik vissza
 *    „foglalatlan"-ra, hanem „jóváhagyásra váró" foglalásként él tovább.
 *    Elutasításnál (reject route) a fázis visszanyílik.
 *  - Egyetlen levél megy a betegnek (lemondás + új ajánlat), a régi slot
 *    fogpótlástanásza a szokásos lemondás-értesítést kapja, az admin-digest a
 *    feltételes ajánlat sorát.
 *
 * Body: { timeSlotId: string; alternativeTimeSlotIds?: string[]; appointmentType?: string | null }
 */
export const dynamic = 'force-dynamic';

const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

type SlotRow = {
  id: string;
  state: string | null;
  status: string | null;
  start_time: string | Date;
};

function effectiveSlotState(row: Pick<SlotRow, 'state' | 'status'>): string {
  return row.state ?? (row.status === 'available' ? 'free' : 'booked');
}

export const POST = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth, params }) => {
  const { id } = params;
  const body = await req.json().catch(() => ({}));
  const { timeSlotId, alternativeTimeSlotIds, appointmentType } = body ?? {};

  if (!timeSlotId || typeof timeSlotId !== 'string') {
    return NextResponse.json(
      { error: 'Az új ajánlat időpontjának (timeSlotId) megadása kötelező', code: 'TIME_SLOT_REQUIRED' },
      { status: 400 }
    );
  }
  if (appointmentType !== undefined && appointmentType !== null && !isAppointmentType(appointmentType)) {
    return NextResponse.json(
      { error: 'Érvénytelen időpont típus érték', code: 'INVALID_APPOINTMENT_TYPE' },
      { status: 400 }
    );
  }
  const alternativeIds: string[] = Array.from(
    new Set(
      (Array.isArray(alternativeTimeSlotIds) ? alternativeTimeSlotIds : [])
        .filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '')
        .map((v: string) => v.trim())
        .filter((v: string) => v !== timeSlotId)
    )
  );

  const pool = getDbPool();
  const client = await pool.connect();
  const changedBy = auth.email ?? auth.userId ?? 'unknown';

  const fail = async (status: number, error: string, code?: string) => {
    await client.query('ROLLBACK').catch(() => {});
    return NextResponse.json(code ? { error, code } : { error }, { status });
  };

  try {
    await client.query('BEGIN');

    const oldResult = await client.query(
      `SELECT
         a.id,
         a.patient_id,
         a.episode_id,
         a.time_slot_id,
         a.slot_intent_id,
         a.created_by,
         a.dentist_email,
         a.google_calendar_event_id,
         a.approval_status,
         a.alternative_time_slot_ids,
         a.appointment_status,
         a.appointment_type,
         a.pool,
         a.duration_minutes,
         a.step_code,
         a.step_seq,
         a.work_phase_id,
         a.attempt_number,
         a.created_via,
         ats.start_time,
         ats.user_id AS time_slot_user_id,
         ats.source AS time_slot_source,
         p.nev AS patient_name,
         p.taj AS patient_taj,
         p.email AS patient_email,
         p.nem AS patient_nem,
         u.email AS time_slot_user_email,
         EXISTS (
           SELECT 1 FROM episode_tasks et
            WHERE et.appointment_id = a.id AND et.task_type = 'recall_due'
         ) AS is_recall_linked
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       JOIN patients p ON a.patient_id = p.id
       JOIN users u ON ats.user_id = u.id
       WHERE a.id = $1
       FOR UPDATE OF a`,
      [id]
    );
    if (oldResult.rows.length === 0) {
      return await fail(404, 'Időpont nem található', 'APPOINTMENT_NOT_FOUND');
    }
    const old = oldResult.rows[0];

    if (auth.role === 'fogpótlástanász' && old.time_slot_user_email !== auth.email) {
      return await fail(403, 'Nincs jogosultsága ezt az időpontot lemondani', 'FORBIDDEN');
    }
    if (old.appointment_status !== null && old.appointment_status !== undefined) {
      return await fail(
        409,
        'Csak nyitott (státusz nélküli) időpont mondható le új ajánlattal — ez az időpont már le van mondva vagy lezárult.',
        'APPOINTMENT_NOT_OPEN'
      );
    }
    if (!old.patient_email || String(old.patient_email).trim() === '') {
      return await fail(
        400,
        'A betegnek nincs e-mail címe — az új ajánlat e-mailben jut el hozzá. Rögzítsen e-mail címet, vagy mondja le ajánlat nélkül.',
        'PATIENT_EMAIL_REQUIRED'
      );
    }
    if (timeSlotId === old.time_slot_id) {
      return await fail(400, 'Az új ajánlat nem lehet ugyanaz az időpont, amit lemond', 'SAME_SLOT');
    }

    const finalType: string | null =
      appointmentType !== undefined ? (appointmentType || null) : (old.appointment_type ?? null);
    if (old.is_recall_linked && finalType !== 'recall') {
      return await fail(
        409,
        'Recall-feladathoz kapcsolt időpont csak recall típusú ajánlattal helyettesíthető',
        'RECALL_TYPE_LOCKED'
      );
    }

    // ── Az új slot zárolása és ellenőrzése ───────────────────────────────
    const newSlotResult = await client.query(
      `SELECT ats.id, ats.state, ats.status, ats.start_time, ats.cim, ats.teremszam, ats.user_id,
              u.email AS dentist_email, u.doktor_neve AS dentist_name
         FROM available_time_slots ats
         JOIN users u ON ats.user_id = u.id
        WHERE ats.id = $1
        FOR UPDATE OF ats`,
      [timeSlotId]
    );
    if (newSlotResult.rows.length === 0) {
      return await fail(404, 'Az ajánlott időpont nem található', 'TIME_SLOT_NOT_FOUND');
    }
    const newSlot = newSlotResult.rows[0];
    if (effectiveSlotState(newSlot) !== 'free') {
      return await fail(409, 'Az ajánlott időpontot időközben más foglalta le.', 'SLOT_ALREADY_BOOKED');
    }
    const newStartTime = new Date(newSlot.start_time);
    if (newStartTime <= new Date()) {
      return await fail(400, 'Csak jövőbeli időpont ajánlható', 'SLOT_IN_PAST');
    }

    if (alternativeIds.length > 0) {
      const altResult = await client.query(
        `SELECT id, state, status, start_time FROM available_time_slots WHERE id = ANY($1::uuid[])`,
        [alternativeIds]
      );
      if (altResult.rows.length !== alternativeIds.length) {
        return await fail(400, 'Egy vagy több alternatív időpont nem található', 'ALTERNATIVE_NOT_FOUND');
      }
      const now = new Date();
      for (const row of altResult.rows as SlotRow[]) {
        if (row.id === old.time_slot_id) {
          return await fail(400, 'A lemondott időpont nem lehet alternatíva', 'ALTERNATIVE_IS_OLD_SLOT');
        }
        if (effectiveSlotState(row) !== 'free') {
          return await fail(400, 'Egy vagy több alternatív időpont már le van foglalva', 'ALTERNATIVE_NOT_FREE');
        }
        if (new Date(row.start_time) <= now) {
          return await fail(400, 'Egy vagy több alternatív időpont már elmúlt', 'ALTERNATIVE_IN_PAST');
        }
      }
    }

    // ── 1) A régi foglalás lemondása (kanonikus minta) ─────────────────────
    if (old.slot_intent_id) {
      await client.query(
        `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND state = 'converted'`,
        [old.slot_intent_id]
      );
    }
    await client.query(
      `UPDATE appointments
          SET appointment_status = 'cancelled_by_doctor',
              slot_intent_id = NULL,
              approval_token = NULL
        WHERE id = $1`,
      [id]
    );
    await client.query(
      `INSERT INTO appointment_status_events (appointment_id, old_status, new_status, created_by)
       VALUES ($1, NULL, 'cancelled_by_doctor', $2)`,
      [id, changedBy]
    );
    await client.query(
      `UPDATE available_time_slots SET status = 'available', state = 'free' WHERE id = $1`,
      [old.time_slot_id]
    );
    // Ha maga a lemondott sor is egy (még nem elfogadott) ajánlat volt, az
    // alternatívái is szabaduljanak fel (a DELETE-tel egyező, idempotens lépés).
    if (old.approval_status === 'pending' && Array.isArray(old.alternative_time_slot_ids)) {
      const oldAltIds = old.alternative_time_slot_ids.filter(
        (v: unknown): v is string => typeof v === 'string' && v !== ''
      );
      if (oldAltIds.length > 0) {
        await client.query(
          `UPDATE available_time_slots SET status = 'available', state = 'free' WHERE id = ANY($1::uuid[])`,
          [oldAltIds]
        );
      }
    }

    // Munkafázis-kötés: a régi foglalásról lekerül (pending + audit) …
    let linkedEwp: { id: string; status: string } | null = null;
    if (old.episode_id) {
      const ewp = await findEwpForAppointmentRevert(client, {
        episodeId: old.episode_id,
        stepCode: old.step_code ?? null,
        workPhaseId: old.work_phase_id ?? null,
        appointmentId: id,
      });
      if (ewp && ewp.appointmentId === id && (ewp.status === 'scheduled' || ewp.status === 'completed')) {
        await revertWorkPhaseLinkToPending(client, {
          ewpId: ewp.id,
          episodeId: old.episode_id,
          oldEwpStatus: ewp.status,
          changedBy,
          reasonText: `appointment ${id} lemondva új e-mailes ajánlattal — fázis átkötés alatt`,
        });
        linkedEwp = { id: ewp.id, status: ewp.status };
      }
    }

    // ── 2) Az új, jóváhagyásra váró ajánlat ────────────────────────────────
    // Az új slot szabad, de egy korábban lemondott foglalás sora még rajta
    // lehet (UNIQUE time_slot_id) — az INSERT előtt el kell takarítani.
    await purgeCancelledAppointmentsOnSlot(client, timeSlotId, {
      exceptAppointmentId: id,
      changedBy,
    });

    const approvalToken = randomBytes(32).toString('hex');
    const insertResult = await client.query(
      `INSERT INTO appointments
         (patient_id, time_slot_id, created_by, dentist_email,
          approval_status, approval_token, alternative_time_slot_ids, current_alternative_index,
          appointment_type, episode_id, pool, duration_minutes, step_code, step_seq, work_phase_id,
          attempt_number, created_via)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb, NULL, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id,
                 patient_id AS "patientId",
                 time_slot_id AS "timeSlotId",
                 episode_id AS "episodeId",
                 work_phase_id AS "workPhaseId",
                 approval_status AS "approvalStatus",
                 appointment_type AS "appointmentType",
                 created_at AS "createdAt"`,
      [
        old.patient_id,
        timeSlotId,
        auth.email,
        newSlot.dentist_email,
        approvalToken,
        JSON.stringify(alternativeIds),
        finalType,
        old.episode_id ?? null,
        old.pool ?? 'work',
        old.duration_minutes ?? 30,
        old.step_code ?? null,
        old.step_seq ?? null,
        old.work_phase_id ?? (linkedEwp ? linkedEwp.id : null),
        old.attempt_number ?? 1,
        old.created_via ?? 'migration',
      ]
    );
    const offer = insertResult.rows[0];

    await client.query(
      `UPDATE available_time_slots SET status = 'booked', state = 'booked' WHERE id = $1`,
      [timeSlotId]
    );

    // … és az új ajánlat átveszi (scheduled + audit + a fázis alkalma örökli).
    if (linkedEwp && old.episode_id) {
      await client.query(
        `UPDATE episode_work_phases
            SET appointment_id = $1,
                status = CASE WHEN status IN ('pending', 'scheduled') THEN 'scheduled' ELSE status END
          WHERE id = $2`,
        [offer.id, linkedEwp.id]
      );
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: linkedEwp.id,
        episodeId: old.episode_id,
        oldStatus: 'pending',
        newStatus: 'scheduled',
        changedBy,
        reason: `Lemondás utáni e-mailes időpont-ajánlat (jóváhagyásra vár) — appointment ${offer.id}`,
      });
      await adoptAppointmentForPhaseVisit(client, linkedEwp.id, offer.id);
    }

    // Recall-feladat: a lemondott sorról az ajánlatra kerül (elutasításnál a
    // reject route engedi el).
    if (old.is_recall_linked) {
      await client.query(
        `UPDATE episode_tasks SET appointment_id = $1
          WHERE appointment_id = $2 AND task_type = 'recall_due'`,
        [offer.id, id]
      );
    }

    if (old.episode_id) {
      await client.query(
        `INSERT INTO scheduling_events (entity_type, entity_id, event_type) VALUES ('episode', $1, 'REPROJECT_INTENTS')`,
        [old.episode_id]
      );
    }

    await client.query('COMMIT');

    // ── Commit utáni, nem blokkoló utómunka ────────────────────────────────
    try {
      await emitSchedulingEvent('appointment', id, 'status_changed');
      await emitSchedulingEvent('appointment', offer.id, 'created');
    } catch {
      // Non-blocking
    }

    const oldStartTime = new Date(old.start_time);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (req.headers.get('origin') || 'http://localhost:3000');
    const dentistFullName = newSlot.dentist_name || newSlot.dentist_email;

    let alternativeSlots: Array<{ id: string; startTime: Date; cim: string | null; teremszam: string | null }> = [];
    if (alternativeIds.length > 0) {
      try {
        const altSlotsResult = await pool.query(
          `SELECT id, start_time, cim, teremszam FROM available_time_slots
            WHERE id = ANY($1::uuid[]) ORDER BY start_time ASC`,
          [alternativeIds]
        );
        alternativeSlots = altSlotsResult.rows.map((row: any) => ({
          id: row.id,
          startTime: new Date(row.start_time),
          cim: row.cim,
          teremszam: row.teremszam,
        }));
      } catch (error) {
        logger.error('[cancel-and-offer] Failed to load alternative slots for notifications:', error);
      }
    }

    const results = await Promise.allSettled([
      sendCancellationWithNewOfferToPatient({
        patientEmail: old.patient_email,
        patientName: old.patient_name,
        patientNem: old.patient_nem,
        cancelledTime: oldStartTime,
        newTime: newStartTime,
        dentistFullName,
        approvalToken,
        baseUrl,
        patientId: old.patient_id,
        cim: newSlot.cim,
        teremszam: newSlot.teremszam,
        hasAlternatives: alternativeIds.length > 0,
      }),
      old.dentist_email
        ? sendAppointmentCancellationNotification(
            old.dentist_email,
            old.patient_name,
            old.patient_taj,
            oldStartTime,
            auth.email,
            `Új időpont-ajánlat ment a betegnek: ${newStartTime.toISOString()} (jóváhagyásra vár)`
          )
        : Promise.resolve(),
      (async () => {
        const adminResult = await pool.query(
          `SELECT email FROM users WHERE role = 'admin' AND active = true`
        );
        const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
        if (adminEmails.length === 0) return;
        await sendConditionalAppointmentNotificationToAdmin(
          adminEmails,
          old.patient_name,
          old.patient_taj,
          old.patient_email,
          newStartTime,
          dentistFullName,
          newSlot.cim,
          newSlot.teremszam,
          alternativeSlots,
          auth.email
        );
      })(),
      releaseGoogleCalendarEventForCancelledSlot(pool, {
        timeSlotId: old.time_slot_id,
        timeSlotUserId: old.time_slot_user_id,
        googleCalendarEventId: old.google_calendar_event_id,
        timeSlotSource: old.time_slot_source,
        startTime: oldStartTime,
        logPrefix: '[Cancel And Offer]',
        freedDescription: 'Szabad időpont (lemondás után felszabadult)',
      }),
    ]);
    results.forEach((r, idx) => {
      if (r.status === 'rejected') {
        logger.error(`[cancel-and-offer] Post-commit step #${idx} failed:`, r.reason);
      }
    });

    await logActivity(
      req,
      auth.email,
      'appointment_cancelled',
      `Appointment ${id}: ${old.patient_name || 'N/A'}, time: ${oldStartTime.toISOString()} — új ajánlat: ${offer.id} @ ${newStartTime.toISOString()} (jóváhagyásra vár)`
    );

    return NextResponse.json(
      {
        success: true,
        cancelledAppointmentId: id,
        offer: {
          ...offer,
          startTime: newStartTime.toISOString(),
          cim: newSlot.cim || DEFAULT_CIM,
          teremszam: newSlot.teremszam ?? null,
          alternativeTimeSlotIds: alternativeIds,
        },
        message: 'Az időpont lemondva, az új ajánlat e-mailben elment a betegnek (jóváhagyásra vár).',
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const translated = translateUniqueViolation(error);
    if (translated) {
      return NextResponse.json(
        { error: translated.error, code: translated.code, hint: translated.hint },
        { status: translated.status }
      );
    }
    throw error;
  } finally {
    client.release();
  }
});
