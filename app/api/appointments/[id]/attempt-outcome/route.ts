/**
 * PATCH /api/appointments/:id/attempt-outcome
 *
 * Migration 029 — sikertelen próba és ismétlés.
 *
 * Két akciót kezel ez az endpoint:
 *   • `mark_unsuccessful` — a vizit megtörtént, de a klinikai cél (pl. jó
 *     lenyomat) nem teljesült. Az appointment `'unsuccessful'` státuszba
 *     kerül, kötelező indokkal. A munkafázis (`episode_work_phases.status`)
 *     visszamegy `'pending'`-be (ha nincs másik aktív appointment), így új
 *     próba foglalható ugyanarra a step_code-ra.
 *   • `revert` — a sikertelennek jelölés visszavonása (tévedés). Az
 *     appointment visszamegy `NULL` (pending) állapotba, az audit mezők
 *     törlődnek, az indok azonban audit logba kerül.
 *
 * Mindkét akcióhoz kötelező a `reason` mező (legalább 5 karakter), amit
 * később klinikai elemzésre használunk (gyakori sikertelenségi okok).
 *
 * Egyéb státuszváltások (cancelled, completed, no_show) továbbra is a
 * `PATCH /api/appointments/:id/status` endpointon mennek.
 */

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT } from '@/lib/active-appointment';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const MIN_REASON_LENGTH = 5;

type AttemptAction = 'mark_unsuccessful' | 'revert';

function parseAction(value: unknown): AttemptAction | null {
  if (value === 'mark_unsuccessful' || value === 'revert') return value;
  return null;
}

export const PATCH = roleHandler(
  ['admin', 'fogpótlástanász', 'beutalo_orvos'],
  async (req, { auth, params }) => {
    const appointmentId = params.id;
    const body = await req.json().catch(() => ({}));
    const action = parseAction(body?.action);
    const reasonRaw = typeof body?.reason === 'string' ? body.reason.trim() : '';

    if (!action) {
      return NextResponse.json(
        {
          error: `Érvénytelen "action". Engedélyezett: 'mark_unsuccessful' vagy 'revert'.`,
          code: 'INVALID_ACTION',
        },
        { status: 400 }
      );
    }

    if (reasonRaw.length < MIN_REASON_LENGTH) {
      return NextResponse.json(
        {
          error: `Az indok megadása kötelező (legalább ${MIN_REASON_LENGTH} karakter). Később elemezzük a gyakori sikertelenségi okokat.`,
          code: 'REASON_REQUIRED',
        },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    await pool.query('BEGIN');
    try {
      const apptRow = await pool.query(
        `SELECT a.id,
                a.episode_id,
                a.step_code,
                a.patient_id,
                a.start_time,
                a.appointment_status as "appointmentStatus",
                a.attempt_number    as "attemptNumber",
                a.work_phase_id     as "workPhaseId",
                p.email             as "patientEmail",
                p.nev               as "patientName"
           FROM appointments a
           LEFT JOIN patients p ON p.id = a.patient_id
          WHERE a.id = $1
          FOR UPDATE OF a`,
        [appointmentId]
      );

      if (apptRow.rows.length === 0) {
        await pool.query('ROLLBACK');
        return NextResponse.json({ error: 'Időpont nem található' }, { status: 404 });
      }

      const appointment = apptRow.rows[0];
      const oldStatus: string | null = appointment.appointmentStatus ?? null;
      const episodeId: string | null = appointment.episode_id ?? null;
      const stepCode: string | null = appointment.step_code ?? null;
      const workPhaseId: string | null = appointment.workPhaseId ?? null;

      let newStatus: string | null;
      if (action === 'mark_unsuccessful') {
        // Engedélyezett forrás-állapotok: pending (NULL), completed, no_show.
        // 'cancelled_*' nem értelmezhető (a vizit nem történt meg), 'unsuccessful'
        // pedig már sikertelen — duplázás megelőzése.
        if (
          oldStatus !== null &&
          oldStatus !== 'completed' &&
          oldStatus !== 'no_show'
        ) {
          await pool.query('ROLLBACK');
          return NextResponse.json(
            {
              error: `Nem jelölhető sikertelennek innen: ${oldStatus}. Engedélyezett kiindulások: pending, completed, no_show.`,
              code: 'INVALID_TRANSITION',
              currentStatus: oldStatus,
            },
            { status: 400 }
          );
        }

        newStatus = 'unsuccessful';
        await pool.query(
          `UPDATE appointments
              SET appointment_status   = 'unsuccessful',
                  attempt_failed_reason = $2,
                  attempt_failed_at     = CURRENT_TIMESTAMP,
                  attempt_failed_by     = $3
            WHERE id = $1`,
          [appointmentId, reasonRaw, auth.email ?? auth.userId ?? 'unknown']
        );
      } else {
        // 'revert' — csak akkor van értelme, ha jelenleg unsuccessful.
        if (oldStatus !== 'unsuccessful') {
          await pool.query('ROLLBACK');
          return NextResponse.json(
            {
              error: `A visszavonás csak sikertelennek jelölt időpontnál értelmezhető. Jelenlegi státusz: ${oldStatus ?? 'pending'}.`,
              code: 'INVALID_TRANSITION',
              currentStatus: oldStatus,
            },
            { status: 400 }
          );
        }

        newStatus = null;
        await pool.query(
          `UPDATE appointments
              SET appointment_status   = NULL,
                  attempt_failed_reason = NULL,
                  attempt_failed_at     = NULL,
                  attempt_failed_by     = NULL
            WHERE id = $1`,
          [appointmentId]
        );
      }

      // Audit: appointment_status_events. Az indok itt nem szerepel közvetlenül
      // (a tábla schema nem tartja), de a `attempt_failed_reason` (mark) ill.
      // a `episode_work_phase_audit` (EWP-átmenet, lent) hordozza.
      await pool.query(
        `INSERT INTO appointment_status_events (appointment_id, old_status, new_status, created_by)
         VALUES ($1, $2, $3, $4)`,
        [appointmentId, oldStatus, newStatus ?? 'pending', auth.email ?? auth.userId ?? 'unknown']
      );

      // EWP státusz frissítése — a munkafázis akkor "scheduled", ha legalább
      // egy aktív appointmentje van; különben "pending". Ezt minden esetben
      // újraszámoljuk a state-átmenet után, hogy konzisztens maradjon.
      let ewpId: string | null = workPhaseId;
      let oldEwpStatus: string | null = null;
      let newEwpStatus: string | null = null;

      if (episodeId && stepCode) {
        // Megkeresés: ha nincs work_phase_id, fallback a (episode, step_code) párra.
        if (!ewpId) {
          const ewpLookup = await pool.query(
            `SELECT id, status FROM episode_work_phases
              WHERE episode_id = $1 AND work_phase_code = $2
                AND (
                  -- ha az oszlop létezik, hagyjuk ki a merged child sorokat
                  NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
                      AND column_name = 'merged_into_episode_work_phase_id'
                  )
                  OR merged_into_episode_work_phase_id IS NULL
                )
              FOR UPDATE`,
            [episodeId, stepCode]
          );
          if (ewpLookup.rows.length === 1) {
            ewpId = ewpLookup.rows[0].id;
            oldEwpStatus = ewpLookup.rows[0].status;
          }
        } else {
          const ewpStatusRow = await pool.query(
            `SELECT status FROM episode_work_phases WHERE id = $1 FOR UPDATE`,
            [ewpId]
          );
          oldEwpStatus = ewpStatusRow.rows[0]?.status ?? null;
        }

        if (ewpId) {
          // Van-e másik aktív (nem cancelled, nem unsuccessful) appointment a step-re?
          const activeRow = await pool.query(
            `SELECT 1 FROM appointments a
              WHERE a.episode_id = $1
                AND a.step_code = $2
                AND a.id <> $3
                AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
              LIMIT 1`,
            [episodeId, stepCode, appointmentId]
          );
          const hasOtherActive = activeRow.rows.length > 0;

          // Az új appt aktív-e? mark_unsuccessful után nem; revert után igen
          // (NULL = active per a canonical taxonomy).
          const thisStillActive = action === 'revert';

          // Csak akkor frissítjük az EWP-t, ha jelenleg nem completed/skipped
          // (azokat csak az újranyitás kezeli, és nem a próba-mechanizmus).
          if (oldEwpStatus === 'pending' || oldEwpStatus === 'scheduled') {
            const desired = hasOtherActive || thisStillActive ? 'scheduled' : 'pending';
            if (desired !== oldEwpStatus) {
              await pool.query(
                `UPDATE episode_work_phases SET status = $1 WHERE id = $2`,
                [desired, ewpId]
              );
              newEwpStatus = desired;

              await pool.query(
                `INSERT INTO episode_work_phase_audit
                   (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                  ewpId,
                  episodeId,
                  oldEwpStatus,
                  desired,
                  auth.email ?? auth.userId ?? 'unknown',
                  action === 'mark_unsuccessful'
                    ? `attempt #${appointment.attemptNumber ?? 1} sikertelen: ${reasonRaw}`
                    : `attempt #${appointment.attemptNumber ?? 1} sikertelen-jelölés visszavonva: ${reasonRaw}`,
                ]
              );
            }
          }
        }
      }

      await pool.query('COMMIT');

      // Post-commit: reproject intents (a változott anchor-lánc miatt) +
      // scheduling event (worklist invalidation).
      if (episodeId) {
        try {
          await projectRemainingSteps(episodeId);
        } catch {
          /* non-blocking: a worklist újrahúzáskor magától korrigál */
        }
        try {
          await emitSchedulingEvent('appointment', appointmentId, 'attempt_outcome_changed');
          await emitSchedulingEvent('episode', episodeId, 'REPROJECT_INTENTS');
        } catch {
          /* non-blocking */
        }
      }

      // Migration 029 / PR 4 D: páciens push notification a sikertelen-jelölés
      // után. NEM küldünk push-ot a `revert` esetén — az csak orvosi audit-művelet,
      // a páciensnek nem jelent semmit. A normál booking notification (új próba
      // foglalásakor) önállóan kimegy a foglalási flow-ból. Csendben kihagyjuk,
      // ha a betegnek nincs push subscription / portal account / email.
      if (action === 'mark_unsuccessful') {
        try {
          const patientEmail: string | null = appointment.patientEmail ?? null;
          if (patientEmail) {
            const userRes = await pool.query(
              `SELECT id FROM users WHERE email = $1 AND active = true`,
              [patientEmail]
            );
            if (userRes.rows.length > 0) {
              const patientUserId: string = userRes.rows[0].id;
              const apptStartIso: string | null = appointment.start_time
                ? new Date(appointment.start_time).toISOString()
                : null;
              const formattedDate = apptStartIso
                ? new Date(apptStartIso).toLocaleString('hu-HU', {
                    timeZone: 'Europe/Budapest',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';
              await sendPushNotification(patientUserId, {
                title: 'Időpont újrabeosztás szükséges',
                body: formattedDate
                  ? `A ${formattedDate}-i időpontot ismételni kell. Hamarosan új időpontot kap.`
                  : 'Időpontját ismételni kell. Hamarosan új időpontot kap.',
                icon: '/icon-192x192.png',
                tag: `attempt-unsuccessful-${appointmentId}`,
                data: {
                  url: `/patient-portal/appointments`,
                  type: 'appointment',
                  id: appointmentId,
                },
                requireInteraction: false,
              });
            }
          }
        } catch (pushError) {
          // Non-blocking: a push hiba nem akadályozza meg a sikertelen-jelölést.
          logger.error('[attempt-outcome] Failed to send patient push notification', {
            appointmentId,
            error: pushError instanceof Error ? pushError.message : String(pushError),
          });
        }
      }

      return NextResponse.json(
        {
          appointmentId,
          action,
          oldStatus,
          newStatus,
          ewpId,
          oldEwpStatus,
          newEwpStatus,
          attemptNumber: appointment.attemptNumber ?? 1,
        },
        { status: 200 }
      );
    } catch (txError) {
      await pool.query('ROLLBACK');
      throw txError;
    }
  }
);
