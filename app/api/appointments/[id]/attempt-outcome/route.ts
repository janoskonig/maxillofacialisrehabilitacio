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
import {
  findEwpForAppointmentRevert,
  revertWorkPhaseLinkToPending,
} from '@/lib/episode-work-phase-revert-lookup';
import { APPOINTMENT_STATUS_EVENT_PENDING_AUDIT } from '@/lib/appointment-status';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';
import { syncRecallTaskForAppointmentStatus } from '@/lib/recall-task-lifecycle';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { translateUniqueViolation } from '@/lib/appointment-constraint-errors';

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
    const client = await pool.connect();

    let appointment: Record<string, unknown> = {};
    let oldStatus: string | null = null;
    let newStatus: string | null = null;
    let episodeId: string | null = null;
    let stepCode: string | null = null;
    let workPhaseId: string | null = null;
    let stepSeq: number | null = null;
    let ewpId: string | null = null;
    let oldEwpStatus: string | null = null;
    let newEwpStatus: string | null = null;
    /**
     * Validációs hibák a tranzakcióban: ROLLBACK + early-return helyett ide
     * tesszük az NextResponse-t és kilépünk a try-blokkból, hogy a `finally`
     * megfelelően release-elje a connectiont. Az `earlyResponse !== null`
     * esetén COMMIT helyett ROLLBACK fut.
     */
    let earlyResponse: NextResponse | null = null;

    try {
      await client.query('BEGIN');

      const apptRow = await client.query(
        `SELECT a.id,
                a.episode_id,
                a.step_code,
                a.step_seq,
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
        earlyResponse = NextResponse.json(
          { error: 'Időpont nem található', code: 'APPOINTMENT_NOT_FOUND' },
          { status: 404 }
        );
      } else {
        appointment = apptRow.rows[0];
        oldStatus = (appointment.appointmentStatus as string | null) ?? null;
        episodeId = (appointment.episode_id as string | null) ?? null;
        stepCode = (appointment.step_code as string | null) ?? null;
        workPhaseId = (appointment.workPhaseId as string | null) ?? null;
        stepSeq = (appointment.step_seq as number | null) ?? null;

        if (action === 'mark_unsuccessful') {
          // Engedélyezett forrás-állapotok: pending (NULL), completed, no_show.
          // 'cancelled_*' nem értelmezhető (a vizit nem történt meg), 'unsuccessful'
          // pedig már sikertelen — duplázás megelőzése.
          if (
            oldStatus !== null &&
            oldStatus !== 'completed' &&
            oldStatus !== 'no_show'
          ) {
            earlyResponse = NextResponse.json(
              {
                error: `Nem jelölhető sikertelennek innen: ${oldStatus}. Engedélyezett kiindulások: pending, completed, no_show.`,
                code: 'INVALID_TRANSITION',
                currentStatus: oldStatus,
              },
              { status: 400 }
            );
          } else {
            newStatus = 'unsuccessful';
            await client.query(
              `UPDATE appointments
                  SET appointment_status   = 'unsuccessful',
                      attempt_failed_reason = $2,
                      attempt_failed_at     = CURRENT_TIMESTAMP,
                      attempt_failed_by     = $3
                WHERE id = $1`,
              [appointmentId, reasonRaw, auth.email ?? auth.userId ?? 'unknown']
            );

            // Audit #04 (WP-0.2): a foglaláshoz kötött `converted` slot_intent
            // lejáratása még EBBEN a tranzakcióban. A post-commit
            // `projectRemainingSteps` nem tud `converted` sort visszanyitni
            // (az UPSERT-je csak `state IN ('open','expired')` sorokat frissít),
            // és második sort sem szúrhat be ugyanarra a lépésre
            // (`uq_slot_intents_episode_step_seq`). Minden testvér-út (lemondás,
            // törlés, fázis-elhagyás) lejáratja az intentet — e nélkül a
            // sikertelen-jelölés után a lépés kimaradna az „Összes szükséges
            // időpont lefoglalása" kötegből.
            await client.query(
              `UPDATE slot_intents si
                  SET state = 'expired', updated_at = CURRENT_TIMESTAMP
                 FROM appointments a
                WHERE a.id = $1
                  AND a.slot_intent_id = si.id
                  AND si.state = 'converted'`,
              [appointmentId]
            );

            // WP-0.4 (kódaudit #03): a sikertelen (halott) sor ne birtokolja
            // tovább az intentet — az `idx_appointments_unique_slot_intent`
            // miatt a visszanyitott intent MÁSIK slotra konverziója különben
            // 23505 → INTENT_ALREADY_CONVERTED 409 lenne. A fenti lejáratás
            // UTÁN fut (az a `a.slot_intent_id` joinra épül).
            await client.query(
              `UPDATE appointments
                  SET slot_intent_id = NULL
                WHERE id = $1
                  AND slot_intent_id IS NOT NULL`,
              [appointmentId]
            );
          }
        } else {
          // 'revert' — csak akkor van értelme, ha jelenleg unsuccessful.
          if (oldStatus !== 'unsuccessful') {
            earlyResponse = NextResponse.json(
              {
                error: `A visszavonás csak sikertelennek jelölt időpontnál értelmezhető. Jelenlegi státusz: ${oldStatus ?? 'pending'}.`,
                code: 'INVALID_TRANSITION',
                currentStatus: oldStatus,
              },
              { status: 400 }
            );
          } else {
            // Audit #08 (WP-0.8): a visszavonás az appointmentet újra AKTÍVVÁ
            // teszi (NULL státusz). Ha a lépésre időközben már lefoglalták a
            // következő próbát, az UPDATE determinisztikusan beleszaladna az
            // `idx_appointments_unique_work_phase_active` / `_pending_step`
            // partial unique indexbe (23505 → generikus „Már létezik ilyen
            // rekord" 409). Ehelyett előre lefuttatjuk ugyanazt az
            // aktív-foglalás szondát, amit lentebb a `hasOtherActive` is
            // használ — elsődlegesen `work_phase_id` szerint, `step_code`-dal
            // csak a legacy (link nélküli) sorokra —, és TÍPUSOS 409-et adunk
            // a blokkoló appointment id-jével (a reassign-step route mintájára).
            const blockerConds: string[] = [];
            const blockerParams: unknown[] = [appointmentId];
            if (workPhaseId) {
              blockerParams.push(workPhaseId);
              blockerConds.push(`a.work_phase_id = $${blockerParams.length}`);
            }
            if (episodeId && stepCode && stepSeq !== null) {
              // A legacy ág az `idx_appointments_unique_pending_step`
              // (episode_id, step_code, step_seq; WHERE appointment_status IS
              // NULL) tényleges szemantikáját tükrözi: csak azonos step_seq-ű,
              // NULL státuszú sor blokkol; NULL step_seq-ű sorok a btree-ben
              // sosem ütköznek, ilyenkor a feltétel el is marad.
              blockerParams.push(episodeId, stepCode, stepSeq);
              blockerConds.push(
                `(a.work_phase_id IS NULL AND a.episode_id = $${blockerParams.length - 2} AND a.step_code = $${blockerParams.length - 1} AND a.step_seq = $${blockerParams.length} AND a.appointment_status IS NULL)`
              );
            }
            const blockerRow =
              blockerConds.length > 0
                ? await client.query(
                    `SELECT a.id FROM appointments a
                      WHERE a.id <> $1
                        AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
                        AND (${blockerConds.join(' OR ')})
                      LIMIT 1`,
                    blockerParams
                  )
                : null;

            if (blockerRow && blockerRow.rows.length > 0) {
              earlyResponse = NextResponse.json(
                {
                  error:
                    'A visszavonás nem lehetséges: erre a lépésre már le van foglalva a következő próba. Előbb mondd le vagy rendezd át a meglévő foglalást.',
                  code: 'RETRY_ALREADY_BOOKED',
                  blockingAppointmentId: blockerRow.rows[0].id as string,
                },
                { status: 409 }
              );
            } else {
              newStatus = null;
              await client.query(
                `UPDATE appointments
                    SET appointment_status   = NULL,
                        attempt_failed_reason = NULL,
                        attempt_failed_at     = NULL,
                        attempt_failed_by     = NULL
                  WHERE id = $1`,
                [appointmentId]
              );
            }
          }
        }
      }

      // Validációs hiba esetén nem írunk audit-eseményt és nem nyúlunk az
      // EWP-hez — a finally a ROLLBACK-et és a release-t garantálja.
      if (!earlyResponse) {
        await syncRecallTaskForAppointmentStatus(client, {
          appointmentId,
          oldStatus,
          newStatus,
        });

        // Audit: appointment_status_events. Az indok itt nem szerepel közvetlenül
        // (a tábla schema nem tartja), de a `attempt_failed_reason` (mark) ill.
        // a `episode_work_phase_audit` (EWP-átmenet, lent) hordozza.
        // A `revert` ágban `newStatus = null` (= pending), de a tábla
        // `new_status` NOT NULL — `APPOINTMENT_STATUS_EVENT_PENDING_AUDIT`
        // egy szándékos audit-only sentinel literál erre az esetre.
        await client.query(
          `INSERT INTO appointment_status_events (appointment_id, old_status, new_status, created_by)
           VALUES ($1, $2, $3, $4)`,
          [
            appointmentId,
            oldStatus,
            newStatus ?? APPOINTMENT_STATUS_EVENT_PENDING_AUDIT,
            auth.email ?? auth.userId ?? 'unknown',
          ]
        );

        // EWP státusz frissítése — a munkafázis akkor "scheduled", ha legalább
        // egy aktív appointmentje van; különben "pending". Ezt minden esetben
        // újraszámoljuk a state-átmenet után, hogy konzisztens maradjon.
        let ewpAppointmentId: string | null = null;

        if (episodeId && stepCode) {
        // Robusztus EWP-keresés: workPhaseId > appointment_id-link > code-only
        // (utóbbi csak ha pontosan 1 találat). Ezzel a multi-step (pl. két
        // `KONTROLL` sor) eseteket se hagyjuk ki csendben.
        const ewp = await findEwpForAppointmentRevert(client, {
          episodeId,
          stepCode,
          workPhaseId,
          appointmentId,
        });
        if (ewp) {
          ewpId = ewp.id;
          oldEwpStatus = ewp.status;
          ewpAppointmentId = ewp.appointmentId;
        }

        if (ewpId) {
          // Van-e másik aktív (nem cancelled, nem unsuccessful) appointment a
          // fázisra? WP-4.1b: work_phase_id-elsődleges párosítás — duplikált
          // work_phase_code-nál a testvér-fázis aktív foglalása nem tarthatja
          // 'scheduled'-ben ezt a fázist. A step_code csak a work_phase_id IS
          // NULL legacy sorok fallbackje (work-phase-delete minta).
          const activeRow = await client.query(
            `SELECT 1 FROM appointments a
              WHERE a.episode_id = $1
                AND (a.work_phase_id = $4 OR (a.work_phase_id IS NULL AND a.step_code = $2))
                AND a.id <> $3
                AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
              LIMIT 1`,
            [episodeId, stepCode, appointmentId, ewpId]
          );
          const hasOtherActive = activeRow.rows.length > 0;

          // Az új appt aktív-e? mark_unsuccessful után nem; revert után igen
          // (NULL = active per a canonical taxonomy).
          const thisStillActive = action === 'revert';

          const changedBy = auth.email ?? auth.userId ?? 'unknown';
          const attemptNum = appointment.attemptNumber ?? 1;

          // mark_unsuccessful + completed fázis: ha ez az appointment kötődik
          // az EWP-hez és nincs másik aktív foglalás a lépésre, a fázist
          // visszanyitjuk pending-re (új próba foglalható).
          const shouldRevertCompletedPhase =
            action === 'mark_unsuccessful' &&
            oldEwpStatus === 'completed' &&
            ewpAppointmentId === appointmentId &&
            !hasOtherActive;

          // revert + (status pending VAGY scheduled) + appointment_id link
          // hiányzik (azaz egy korábbi `mark_unsuccessful` lenullázta) →
          // helyreállítjuk a linket, hogy ne legyen `EWP_DANGLING_*` reverz
          // (van active foglalás, de senki nem mutat rá az EWP-ről).
          // Csak ha ez az egyetlen aktív foglalás a lépésen (ne ütközzünk
          // egy időközben máshol létrehozott foglalással).
          const shouldReattachOnRevert =
            action === 'revert' &&
            ewpAppointmentId === null &&
            !hasOtherActive;

          if (shouldRevertCompletedPhase) {
            await revertWorkPhaseLinkToPending(client, {
              ewpId,
              episodeId,
              oldEwpStatus: 'completed',
              changedBy,
              reasonText: `attempt #${attemptNum} sikertelen (completed fázis visszanyitva): ${reasonRaw}`,
            });
            newEwpStatus = 'pending';
          } else if (shouldReattachOnRevert) {
            // Visszakötjük a foglalást és scheduled-re állítjuk az EWP-t
            // (függetlenül attól, hogy pending vagy scheduled volt: a revert
            // után aktív foglalásunk van, ez „scheduled" fázis).
            const desired = 'scheduled';
            await client.query(
              `UPDATE episode_work_phases
               SET status = $1, appointment_id = $2
               WHERE id = $3`,
              [desired, appointmentId, ewpId]
            );
            newEwpStatus = desired;
            if (oldEwpStatus !== desired || ewpAppointmentId !== appointmentId) {
              // oldEwpStatus itt biztosan nem null: az ewpId-guard csak akkor
              // enged ide, ha az EWP-t megtaláltuk (status kitöltve).
              await insertWorkPhaseAudit(client, {
                episodeWorkPhaseId: ewpId,
                episodeId,
                oldStatus: oldEwpStatus!,
                newStatus: desired,
                changedBy,
                reason: `attempt #${attemptNum} sikertelen-jelölés visszavonva (link helyreállítva): ${reasonRaw}`,
              });
            }
          } else if (oldEwpStatus === 'pending' || oldEwpStatus === 'scheduled') {
            const desired = hasOtherActive || thisStillActive ? 'scheduled' : 'pending';
            // mark_unsuccessful, ami pending-re viszi az EWP-t és ezen az EWP-n
            // pont ez az appointment volt linkelve: a linket is nullázzuk, hogy
            // ne maradjon `EWP_DANGLING_APPOINTMENT_LINK` (a foglalás már
            // unsuccessful, nem látható).
            const shouldClearLink =
              action === 'mark_unsuccessful' &&
              desired === 'pending' &&
              ewpAppointmentId === appointmentId;

            if (desired !== oldEwpStatus || shouldClearLink) {
              if (shouldClearLink) {
                await client.query(
                  `UPDATE episode_work_phases
                   SET status = $1, appointment_id = NULL
                   WHERE id = $2`,
                  [desired, ewpId]
                );
              } else {
                await client.query(
                  `UPDATE episode_work_phases SET status = $1 WHERE id = $2`,
                  [desired, ewpId]
                );
              }
              newEwpStatus = desired;

              if (desired !== oldEwpStatus) {
                await insertWorkPhaseAudit(client, {
                  episodeWorkPhaseId: ewpId,
                  episodeId,
                  oldStatus: oldEwpStatus,
                  newStatus: desired,
                  changedBy,
                  reason:
                    action === 'mark_unsuccessful'
                      ? `attempt #${attemptNum} sikertelen: ${reasonRaw}`
                      : `attempt #${attemptNum} sikertelen-jelölés visszavonva: ${reasonRaw}`,
                });
              }
            }
          }
        }
        }
      }

      if (earlyResponse) {
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
      }
    } catch (txError) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* már bezárt connection — felejtsük el */
      }
      // Audit #08 (WP-0.8): versenyhelyzet-hátvéd — ha a fenti szonda és az
      // UPDATE között foglalták le a következő próbát, a 23505-öt típusos
      // 409-re fordítjuk a generikus „Már létezik ilyen rekord" helyett.
      const translation = translateUniqueViolation(txError);
      if (translation) {
        return NextResponse.json(
          {
            error: translation.error,
            code: translation.code,
            ...(translation.hint ? { hint: translation.hint } : {}),
          },
          { status: translation.status }
        );
      }
      throw txError;
    } finally {
      client.release();
    }

    if (earlyResponse) {
      return earlyResponse;
    }

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
        const patientEmail = (appointment.patientEmail as string | null) ?? null;
        if (patientEmail) {
          const userRes = await pool.query(
            `SELECT id FROM users WHERE email = $1 AND active = true`,
            [patientEmail]
          );
          if (userRes.rows.length > 0) {
            const patientUserId: string = userRes.rows[0].id;
            const startTimeRaw = appointment.start_time as string | Date | null | undefined;
            const apptStartIso: string | null = startTimeRaw
              ? new Date(startTimeRaw).toISOString()
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
            }, { patientId: appointment.patient_id as string });
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
  }
);
