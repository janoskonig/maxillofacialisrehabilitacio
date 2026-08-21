import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import {
  APPOINTMENT_STATUS_VALUES,
  parseAppointmentStatus,
} from '@/lib/appointment-status';
import { SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT } from '@/lib/active-appointment';
import { APPOINTMENT_TYPE_VALUES } from '@/lib/appointment-constants';
import {
  findEwpForAppointmentRevert,
  revertWorkPhaseLinkToPending,
} from '@/lib/episode-work-phase-revert-lookup';
import {
  applyAppointmentStageTransition,
  parseAppointmentClinicalEvent,
  type AppointmentStageTransitionResult,
} from '@/lib/appointment-stage-transition';
import { clearSuggestion } from '@/lib/stage-suggestion-service';
import { ensureRecallTasksForEpisode } from '@/lib/recall-tasks';
import { logActivity } from '@/lib/activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const PATCH = roleHandler(['admin', 'fogpótlástanász', 'beutalo_orvos'], async (req, { auth, params }) => {
  const appointmentId = params.id;
  const body = await req.json();
  const {
    appointmentStatus,
    completionNotes,
    isLate,
    appointmentType,
    typeLabel,
    clinicalEvent: clinicalEventRaw,
    stageCode: requestedStageCodeRaw,
  } = body;

  // Pipe through the canonical taxonomy guard so any new status value added to
  // the SQL CHECK constraint requires updating lib/appointment-status.ts AND
  // the test suite in lockstep — preventing drift.
  const parsed = parseAppointmentStatus(appointmentStatus);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: `Érvénytelen státusz érték. Engedélyezett: ${APPOINTMENT_STATUS_VALUES.join(', ')} vagy NULL.`,
        code: 'INVALID_APPOINTMENT_STATUS',
      },
      { status: 400 }
    );
  }
  const normalisedStatus = parsed.status;
  const clinicalEvent = parseAppointmentClinicalEvent(clinicalEventRaw);
  const requestedStageCode =
    typeof requestedStageCodeRaw === 'string' && requestedStageCodeRaw.trim()
      ? requestedStageCodeRaw.trim()
      : null;

  if (clinicalEventRaw != null && clinicalEventRaw !== '' && !clinicalEvent) {
    return NextResponse.json(
      { error: 'Érvénytelen klinikai esemény', code: 'INVALID_CLINICAL_EVENT' },
      { status: 400 },
    );
  }

  if ((clinicalEvent || requestedStageCode) && normalisedStatus !== 'completed') {
    return NextResponse.json(
      {
        error: 'Klinikai esemény vagy stádiumváltás csak teljesült időponthoz rögzíthető',
        code: 'STAGE_CHANGE_REQUIRES_COMPLETED_APPOINTMENT',
      },
      { status: 400 },
    );
  }

  if (clinicalEvent === 'delivery' && requestedStageCode && requestedStageCode !== 'STAGE_6') {
    return NextResponse.json(
      {
        error: 'Átadás eseménynél a célstádium automatikusan STAGE_6',
        code: 'DELIVERY_STAGE_CONFLICT',
      },
      { status: 400 },
    );
  }

  if (normalisedStatus === 'completed' && (!completionNotes || completionNotes.trim() === '')) {
    return NextResponse.json(
      { error: 'A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén', code: 'COMPLETION_NOTES_REQUIRED' },
      { status: 400 }
    );
  }

  // Migration 029: a sikertelen-jelölés a dedikált
  // PATCH /api/appointments/:id/attempt-outcome endpointon megy, mert ott
  // kötelező az indok, és ott történik az episode_work_phases visszaforgatása
  // pending-be (hogy új próba foglalható legyen). Itt elutasítjuk, nehogy
  // valaki indok nélkül állítsa át.
  if (normalisedStatus === 'unsuccessful') {
    return NextResponse.json(
      {
        error:
          'A sikertelen-jelölés a PATCH /api/appointments/:id/attempt-outcome végponton mehet, mert kötelező hozzá indok és a munkafázis visszaállítása.',
        code: 'USE_ATTEMPT_OUTCOME_ENDPOINT',
      },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  const client = await pool.connect();
  let stageTransition: AppointmentStageTransitionResult | null = null;
  let episodeIdForStage: string | null = null;

  try {
    await client.query('BEGIN');

    const appointmentResult = await client.query(
      `SELECT id,
              appointment_status AS "appointmentStatus",
              episode_id         AS "episodeId",
              step_code          AS "stepCode",
              work_phase_id      AS "workPhaseId",
              COALESCE(start_time, created_at) AS "appointmentAt"
       FROM appointments WHERE id = $1 FOR UPDATE`,
      [appointmentId]
    );

    if (appointmentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Időpont nem található', code: 'APPOINTMENT_NOT_FOUND' },
        { status: 404 }
      );
    }

    const apptBefore = appointmentResult.rows[0];
    const oldStatus = apptBefore.appointmentStatus ?? null;
    const episodeIdForEwp: string | null = apptBefore.episodeId ?? null;
    episodeIdForStage = episodeIdForEwp;
    const stepCodeForEwp: string | null = apptBefore.stepCode ?? null;
    const workPhaseIdForEwp: string | null = apptBefore.workPhaseId ?? null;

    const updateFields: string[] = [];
    const updateValues: unknown[] = [];
    let paramIndex = 1;

    if (appointmentStatus !== undefined) {
      updateFields.push(`appointment_status = $${paramIndex}`);
      updateValues.push(normalisedStatus);
      paramIndex++;
    }

    if (normalisedStatus === 'completed') {
      stageTransition = await applyAppointmentStageTransition({
        client,
        appointmentId,
        episodeId: episodeIdForStage,
        appointmentAt: new Date(apptBefore.appointmentAt),
        appointmentStepCode: apptBefore.stepCode ?? null,
        clinicalEvent,
        requestedStageCode,
        changedBy: auth.email ?? auth.userId ?? 'unknown',
      });
    }

    if (completionNotes !== undefined) {
      updateFields.push(`completion_notes = $${paramIndex}`);
      updateValues.push(completionNotes && completionNotes.trim() !== '' ? completionNotes.trim() : null);
      paramIndex++;
    }

    if (isLate !== undefined) {
      updateFields.push(`is_late = $${paramIndex}`);
      updateValues.push(isLate === true);
      paramIndex++;
    }

    if (appointmentType !== undefined) {
      if (appointmentType !== null && appointmentType !== undefined) {
        if (!(APPOINTMENT_TYPE_VALUES as string[]).includes(appointmentType)) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Érvénytelen időpont típus érték', code: 'INVALID_APPOINTMENT_TYPE' },
            { status: 400 }
          );
        }
      }
      updateFields.push(`appointment_type = $${paramIndex}`);
      updateValues.push(appointmentType || null);
      paramIndex++;
    }

    // Free-text type label (catch-all flag, e.g. "implantátum kontroll 6h").
    // Trimmed; empty string clears it.
    if (typeLabel !== undefined) {
      const trimmed = typeof typeLabel === 'string' ? typeLabel.trim() : '';
      updateFields.push(`type_label = $${paramIndex}`);
      updateValues.push(trimmed.length > 0 ? trimmed.slice(0, 120) : null);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Nincs módosítandó mező' },
        { status: 400 }
      );
    }

    updateValues.push(appointmentId);

    const updateResult = await client.query(
      `UPDATE appointments 
     SET ${updateFields.join(', ')} 
     WHERE id = $${paramIndex}
     RETURNING
       id,
       appointment_status as "appointmentStatus",
       completion_notes as "completionNotes",
       is_late as "isLate",
       appointment_type as "appointmentType",
       type_label as "typeLabel"`,
      updateValues
    );

    const appointment = updateResult.rows[0];
    if (!appointment) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Az időpont frissítése sikertelen volt (adatbázis nem adott vissza eredményt)' },
        { status: 500 }
      );
    }

    if (appointmentStatus !== undefined) {
      const newStatus = appointment.appointmentStatus;
      if (newStatus !== undefined && newStatus !== null) {
        const createdBy = auth.email ?? auth.userId ?? 'unknown';
        await client.query(
          `INSERT INTO appointment_status_events (appointment_id, old_status, new_status, created_by)
           VALUES ($1, $2, $3, $4)`,
          [appointmentId, oldStatus, newStatus, createdBy]
        );
      } else {
        console.warn('[appointment_status_events] Skipping emit: UPDATE succeeded but RETURNING did not contain appointmentStatus', { appointmentId });
      }
    }

    // "Inactive or no-show" → expire the converted slot intent and reproject
    // remaining steps. Mirror of the canonical guard list in
    // lib/active-appointment.ts (cancelled set + no_show, since no_show should
    // also kick off reprojection even if it doesn't free the partial-unique slot).
    const isCancelOrNoShow =
      normalisedStatus === 'cancelled_by_doctor' ||
      normalisedStatus === 'cancelled_by_patient' ||
      normalisedStatus === 'no_show';

    if (isCancelOrNoShow) {
      // Ezen a ponton már `isCancelOrNoShow` (cancelled_by_doctor /
      // cancelled_by_patient / no_show). MINDEGYIK esetben vissza kell nyitni a
      // kezelési fázist `pending`-re és leoldani a foglalás-linket, ha az EWP
      // erre az appointmentre mutatott (completed VAGY scheduled státuszból):
      //   • completed → cancel/no_show: a korábban lezárt fázis újranyílik.
      //   • scheduled → cancel/no_show: a befoglalt fázis újra foglalhatóvá válik.
      // Enélkül az EWP `scheduled` maradna a halott (lemondott / meg-nem-jelent)
      // foglaláshoz láncolva, a worklist nem mutatná újra-foglalandóként, és
      // `EWP_DANGLING_APPOINTMENT_LINK` integritás-sértés keletkezne. A no_show
      // slotja elhasználva marad (lásd lentebb), a cancelled slotja felszabadul.
      if (episodeIdForEwp && stepCodeForEwp) {
        const ewp = await findEwpForAppointmentRevert(client, {
          episodeId: episodeIdForEwp,
          stepCode: stepCodeForEwp,
          workPhaseId: workPhaseIdForEwp,
          appointmentId,
        });

        if (
          ewp &&
          ewp.appointmentId === appointmentId &&
          (ewp.status === 'completed' || ewp.status === 'scheduled')
        ) {
          const otherActive = await client.query(
            `SELECT 1 FROM appointments a
             WHERE a.episode_id = $1
               AND a.step_code = $2
               AND a.id <> $3
               AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
             LIMIT 1`,
            [episodeIdForEwp, stepCodeForEwp, appointmentId]
          );
          if (otherActive.rows.length === 0) {
            await revertWorkPhaseLinkToPending(client, {
              ewpId: ewp.id,
              episodeId: episodeIdForEwp,
              oldEwpStatus: ewp.status,
              changedBy: auth.email ?? auth.userId ?? 'unknown',
              reasonText: `appointment ${appointmentId} státusza ${normalisedStatus}-re változott (utólagos jelölés) — fázis visszanyitva`,
            });
          }
        }
      }

      await client.query(
        `UPDATE slot_intents si
         SET state = 'expired', updated_at = CURRENT_TIMESTAMP
         FROM appointments a
         WHERE a.id = $1
           AND a.slot_intent_id = si.id
           AND si.state = 'converted'`,
        [appointmentId]
      );

      // Slot-state ↔ appointment_status szinkron (W: bulk-convert robustness).
      // A cancelled_by_* megsz\u00fcntet\u00e9s mostm\u00e1r felszabad\u00edtja a slotot is, hogy a
      // bulk-convert / individual booking flow \u00fajra haszn\u00e1lhassa. A `no_show`-ra
      // direkt NEM nyúlunk: a kanonikus taxonómia (lib/active-appointment.ts:23-25)
      // szerint a no_show "active" — a slotot foglaltnak tekintjük, mert az
      // időpont valós időben "elkelt" (a beteg nem jött el, de a slot már nem
      // adható másnak ugyanarra az időre).
      if (
        normalisedStatus === 'cancelled_by_doctor' ||
        normalisedStatus === 'cancelled_by_patient'
      ) {
        await client.query(
          `UPDATE available_time_slots ats
              SET state = 'free', status = 'available'
              FROM appointments a
              WHERE a.id = $1
                AND a.time_slot_id = ats.id`,
          [appointmentId]
        );
      }

      // A REPROJECT_INTENTS event-et az episodeIdForEwp-ből vesszük, amit
      // már a tranzakció elején FOR UPDATE-tel olvastunk — nem kell külön
      // re-fetch-elni az appointment-ből (extra round-trip megtakarítás
      // + race-mentes a párhuzamos episode_id módosítás ellen).
      if (episodeIdForEwp) {
        await client.query(
          `INSERT INTO scheduling_events (entity_type, entity_id, event_type) VALUES ('episode', $1, 'REPROJECT_INTENTS')`,
          [episodeIdForEwp]
        );
      }
    }

    await client.query('COMMIT');

    if (appointmentStatus !== undefined) {
      try {
        await emitSchedulingEvent('appointment', appointmentId, 'status_changed');
      } catch {
        // Non-blocking
      }
    }


    if (stageTransition?.changed && episodeIdForStage) {
      try {
        await clearSuggestion(episodeIdForStage);
        if (stageTransition.stageCode === 'STAGE_6') {
          await ensureRecallTasksForEpisode(episodeIdForStage);
        }
      } catch (error) {
        logger.error('[appointment-status] Stádium utómunkálat sikertelen', {
          appointmentId,
          episodeId: episodeIdForStage,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await logActivity(
        req,
        auth.email ?? auth.userId ?? 'unknown',
        'patient_stage_changed_from_appointment',
        JSON.stringify({
          appointmentId,
          episodeId: episodeIdForStage,
          stageCode: stageTransition.stageCode,
          at: stageTransition.at,
          source: stageTransition.source,
        }),
      );
    }

    return NextResponse.json({
      appointment,
      stageTransition,
    }, { status: 200 });
  } catch (txError) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* már bezárt connection — felejtsük el */
    }
    const stageErrorMap: Record<string, { error: string; code: string }> = {
      STAGE_TRANSITION_REQUIRES_EPISODE: {
        error: 'Ehhez az időponthoz nincs aktív ellátási epizód, ezért a stádium nem váltható.',
        code: 'STAGE_TRANSITION_REQUIRES_EPISODE',
      },
      STAGE_EPISODE_NOT_FOUND: {
        error: 'Az időponthoz kapcsolt ellátási epizód nem található.',
        code: 'STAGE_EPISODE_NOT_FOUND',
      },
      STAGE_EPISODE_NOT_OPEN: {
        error: 'Csak aktív ellátási epizód stádiuma módosítható.',
        code: 'STAGE_EPISODE_NOT_OPEN',
      },
      INVALID_STAGE_FOR_EPISODE: {
        error: 'A kiválasztott stádium nem érvényes ehhez az ellátási epizódhoz.',
        code: 'INVALID_STAGE_FOR_EPISODE',
      },
    };
    const mapped = txError instanceof Error ? stageErrorMap[txError.message] : undefined;
    if (mapped) return NextResponse.json(mapped, { status: 400 });
    throw txError;
  } finally {
    client.release();
  }
});
