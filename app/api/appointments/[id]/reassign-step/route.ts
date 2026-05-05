import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { logActivity } from '@/lib/activity';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { isAppointmentActive } from '@/lib/active-appointment';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/appointments/:id/reassign-step
 *
 * Egy meglévő foglalás átkötése ugyanazon epizód egy MÁSIK
 * `episode_work_phases` sorára — a slot (time_slot_id) és a foglalás maga
 * NEM változik, csak a fázis-hovatartozás (step_code, step_seq, work_phase_id
 * és az `episode_work_phases.appointment_id` linkek).
 *
 * Múltbeli foglalásokra is működik (snapshot-rögzítés utólagos javítása,
 * pl. ha a foglaláskor rossz step_code-ot rögzítettek admin override-ban).
 * Ilyenkor a cél fázis lehet completed is — a státuszát nem írjuk át,
 * csak az `appointment_id`-t frissítjük.
 *
 * Szigorú védelmek (óvatos művelet):
 *  - auth: csak admin / beutalo_orvos / fogpótlástanász.
 *  - Ugyanaz az epizód (kereszt-epizód át-rendelés nincs).
 *  - Ugyanaz a `pool` (control / work / consult nem keveredhet).
 *  - A cél nem lehet merged vagy skipped, és nem foglalhat helyet
 *    másik aktív appointment (partial unique index védelme alatt is).
 *  - A foglalás aktív kell legyen (lemondott / sikertelen / no-show
 *    foglalást nem lehet áthelyezni).
 *
 * Transaction-ban frissíti:
 *  - a régi `episode_work_phases.appointment_id`-t NULL-ra,
 *    `scheduled` → `pending` státusz audit-tal (a `completed` érintetlen
 *    marad — csak a link vesz le róla),
 *  - a cél `episode_work_phases.appointment_id`-t erre az appointmentre.
 *    Ha a cél `pending`/`scheduled` volt → `scheduled`. Ha `completed`
 *    volt → `completed` marad (a fázis tényállapota nem változik
 *    pusztán a snapshot-átírástól), csak az `appointment_id` frissül.
 *  - `appointments.step_code / step_seq / work_phase_id` mezőket a cél
 *    fázisra.
 *
 * Utólag (non-blocking):
 *  - `projectRemainingSteps` → slot_intent projektor frissíti a maradék
 *    lépések anchor-láncát,
 *  - `scheduling_events` → worklist cache invalidáció.
 */
export const PATCH = roleHandler(
  ['admin', 'beutalo_orvos', 'fogpótlástanász'],
  async (req, { auth, params }) => {
    const appointmentId = params.id;

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const targetWorkPhaseId =
      typeof body?.targetWorkPhaseId === 'string' && body.targetWorkPhaseId.length > 0
        ? body.targetWorkPhaseId
        : null;
    const reasonInput =
      typeof body?.reason === 'string' ? body.reason.trim() : '';

    if (!targetWorkPhaseId) {
      return NextResponse.json(
        { error: 'targetWorkPhaseId kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    const client = await pool.connect();

    interface AppointmentRow {
      id: string;
      episodeId: string | null;
      stepCode: string | null;
      stepSeq: number | null;
      workPhaseId: string | null;
      pool: string;
      isFuture: boolean;
      isActiveStatus: boolean;
      appointmentStatus: string | null;
    }
    interface TargetRow {
      id: string;
      episodeId: string;
      workPhaseCode: string;
      pathwayOrderIndex: number | null;
      pool: string;
      status: string;
      appointmentId: string | null;
      mergedIntoWorkPhaseId: string | null;
      linkedAppointmentStatus: string | null;
      linkedAppointmentExistsId: string | null;
    }

    // Az `appt` és `target` típust előre deklaráljuk, hogy a tranzakció
    // után (logActivity / projector / event) is hozzáférjünk az értékükhöz.
    // A tényleges SELECT a tranzakción belül megy `FOR UPDATE`-tel, hogy
    // ne lehessen TOCTOU-race a validáció és az UPDATE-ek között.
    let appt: AppointmentRow | null = null;
    let target: TargetRow | null = null;
    let targetHasStaleLink = false;
    const changedBy = auth.email ?? auth.userId ?? 'unknown';
    const reasonSuffix = reasonInput.length > 0 ? ` — ${reasonInput}` : '';

    try {
      await client.query('BEGIN');

      // A foglalás-sort mindig FOR UPDATE-tel olvassuk: a párhuzamos
      // status / cancel / attempt-outcome műveletek így blokkolódnak
      // a tranzakció végéig, és nem tudjuk stale `isActiveStatus`-ra
      // alapozva eldönteni az átrendezés engedélyezését.
      const apptResult = await client.query(
        `SELECT a.id,
                a.episode_id          AS "episodeId",
                a.step_code           AS "stepCode",
                a.step_seq            AS "stepSeq",
                a.work_phase_id       AS "workPhaseId",
                a.pool,
                a.is_future           AS "isFuture",
                a.is_active_status    AS "isActiveStatus",
                a.appointment_status  AS "appointmentStatus"
         FROM appointments a
         WHERE a.id = $1
         FOR UPDATE OF a`,
        [appointmentId]
      );

      if (apptResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Foglalás nem található' },
          { status: 404 }
        );
      }

      appt = apptResult.rows[0] as AppointmentRow;

      if (!appt.episodeId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Csak epizódhoz kötött foglalás rendelhető át másik fázishoz' },
          { status: 400 }
        );
      }

      if (!appt.isActiveStatus) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Inaktív / lemondott foglalás nem rendelhető át (status: ${appt.appointmentStatus ?? 'n/a'})`,
          },
          { status: 400 }
        );
      }

      // Cél EWP + a hozzá (esetlegesen) kötött appointment státusza, hogy ki
      // tudjuk szűrni a stale linkeket (cancelled / unsuccessful / törölt
      // appointment). FOR UPDATE az ewp soron — nem zárolja a linked
      // appointment-et (ha van), mert annak státuszát csak olvassuk a
      // stale-detekcióhoz; ha közben átírják, a worst case egy felesleges
      // 400 (amit a felhasználó újrapróbál).
      const targetResult = await client.query(
        `SELECT ewp.id,
                ewp.episode_id                         AS "episodeId",
                ewp.work_phase_code                    AS "workPhaseCode",
                ewp.pathway_order_index                AS "pathwayOrderIndex",
                ewp.pool,
                ewp.status,
                ewp.appointment_id                     AS "appointmentId",
                ewp.merged_into_episode_work_phase_id  AS "mergedIntoWorkPhaseId",
                ta.appointment_status                   AS "linkedAppointmentStatus",
                ta.id                                   AS "linkedAppointmentExistsId"
         FROM episode_work_phases ewp
         LEFT JOIN appointments ta ON ta.id = ewp.appointment_id
         WHERE ewp.id = $1
         FOR UPDATE OF ewp`,
        [targetWorkPhaseId]
      );

      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Cél munkafázis nem található' },
          { status: 404 }
        );
      }

      target = targetResult.rows[0] as TargetRow;

      if (target.episodeId !== appt.episodeId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'A cél munkafázis más epizódhoz tartozik' },
          { status: 400 }
        );
      }

      if (target.mergedIntoWorkPhaseId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error:
              'A cél munkafázis összevont (merged) sor — közvetlenül nem rendelhető hozzá foglalás. Rendeld a fő (primary) sorhoz.',
          },
          { status: 400 }
        );
      }

      if (target.status === 'skipped') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error:
              'A cél munkafázis kihagyott (skipped) — nem rendelhető hozzá foglalás. Előbb állítsd vissza pendingre.',
          },
          { status: 400 }
        );
      }
      // target.status === 'completed' szándékosan engedélyezett: utólagos
      // snapshot-rögzítés esetén a fázis tényállapota nem változik (marad
      // completed), csak az appointment_id link frissül.

      if (target.pool !== appt.pool) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Pool eltérés: a foglalás "${appt.pool}", a cél fázis "${target.pool}". Az áthelyezéshez azonos pool kell.`,
          },
          { status: 400 }
        );
      }

      // Stale link detektálás: a cél EWP.appointment_id mutathat olyan
      // foglalásra, ami már lemondott / sikertelen / törölt (nem létező sor).
      // Ezeket NEM tekintjük blokkolónak — csak logoljuk, és a tranzakcióban
      // lenullázzuk a linket. Csak AKTÍV, más id-jű foglalást utasítunk vissza.
      targetHasStaleLink =
        !!target.appointmentId &&
        target.appointmentId !== appointmentId &&
        (target.linkedAppointmentExistsId == null ||
          !isAppointmentActive(target.linkedAppointmentStatus as string | null | undefined));

      if (
        target.appointmentId &&
        target.appointmentId !== appointmentId &&
        !targetHasStaleLink
      ) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error:
              'A cél munkafázishoz már tartozik egy másik aktív foglalás — előbb azt kell törölni / átrendezni.',
            linkedAppointmentId: target.appointmentId,
            linkedAppointmentStatus: target.linkedAppointmentStatus ?? null,
          },
          { status: 400 }
        );
      }

      if (target.id === appt.workPhaseId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'A foglalás már ehhez a fázishoz van rendelve' },
          { status: 400 }
        );
      }

      // A partial unique index (idx_appointments_unique_work_phase_active)
      // miatt a work_phase_id-t NEM állíthatjuk közvetlenül target.id-ra, ha a
      // cél EWP appointment_id-je épp mutat erre a foglalásra. Sorrend:
      //   1) appointment.work_phase_id = NULL
      //   2) ha a cél EWP-n stale link van (cancelled / unsuccessful / törölt
      //      foglalásra mutat), lenullázzuk ÉS naplózzuk az audit-ba
      //   3) régi EWP linkek törlése + audit
      //   4) cél EWP appointment_id = appointmentId, status = scheduled + audit
      //   5) appointment step_code / step_seq / work_phase_id beállítása
      await client.query(
        `UPDATE appointments SET work_phase_id = NULL WHERE id = $1`,
        [appointmentId]
      );

      // A fenti validáció-ágak mind ROLLBACK + return-nel végződnek,
      // így innentől biztosan be van állítva az `appt` és `target`.
      // A non-null asserciókat (!) szándékosan használjuk a tranzakciós
      // kódblokkban, hogy a TS típusrendszerét ne kelljen extra őrökkel
      // terhelni.
      const apptInTx = appt;
      const targetInTx = target;

      // A cél EWP aktuális státuszát követjük — a stale-clear után
      // változhat, és az utolsó audit-bejegyzéshez erre lesz szükség.
      let targetCurrentStatus: string = targetInTx.status;

      if (targetHasStaleLink) {
        const staleStatusLabel =
          targetInTx.linkedAppointmentExistsId == null
            ? 'nem létezik'
            : (targetInTx.linkedAppointmentStatus ?? 'ismeretlen');
        await client.query(
          `UPDATE episode_work_phases
           SET appointment_id = NULL,
               status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
           WHERE id = $1`,
          [targetInTx.id]
        );
        if (targetInTx.status === 'scheduled') {
          await client.query(
            `INSERT INTO episode_work_phase_audit
               (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              targetInTx.id,
              apptInTx.episodeId,
              'scheduled',
              'pending',
              changedBy,
              `stale appointment_id takarítása (mutatott: ${targetInTx.appointmentId}, status: ${staleStatusLabel}) reassign előtt${reasonSuffix}`,
            ]
          );
          targetCurrentStatus = 'pending';
        }
      }

      const oldLinkedResult = await client.query(
        `SELECT id, work_phase_code AS "workPhaseCode", status
         FROM episode_work_phases
         WHERE episode_id = $1 AND appointment_id = $2 AND id <> $3`,
        [apptInTx.episodeId, appointmentId, targetInTx.id]
      );

      for (const oldEwp of oldLinkedResult.rows) {
        const prevStatus: string = oldEwp.status;
        await client.query(
          `UPDATE episode_work_phases
           SET appointment_id = NULL,
               status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
           WHERE id = $1`,
          [oldEwp.id]
        );

        if (prevStatus === 'scheduled') {
          await client.query(
            `INSERT INTO episode_work_phase_audit
               (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              oldEwp.id,
              apptInTx.episodeId,
              'scheduled',
              'pending',
              changedBy,
              `appointment ${appointmentId} átrendezve másik fázisra (${oldEwp.workPhaseCode} → ${targetInTx.workPhaseCode})${reasonSuffix}`,
            ]
          );
        }
      }

      // Cél új státusza:
      //   - ha completed volt → marad completed (csak az appointment_id frissül)
      //   - egyébként → scheduled
      // Ezzel a múltbeli (snapshot-rögzítő) áthelyezés nem alakítja a fázis
      // tényállapotát, csak a hivatkozást frissíti.
      const newTargetStatus =
        targetCurrentStatus === 'completed' ? 'completed' : 'scheduled';

      await client.query(
        `UPDATE episode_work_phases
         SET appointment_id = $1, status = $2
         WHERE id = $3`,
        [appointmentId, newTargetStatus, targetInTx.id]
      );

      if (targetCurrentStatus !== newTargetStatus) {
        await client.query(
          `INSERT INTO episode_work_phase_audit
             (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            targetInTx.id,
            apptInTx.episodeId,
            targetCurrentStatus,
            newTargetStatus,
            changedBy,
            `appointment ${appointmentId} ide rendelve (${apptInTx.stepCode ?? 'n/a'} → ${targetInTx.workPhaseCode})${reasonSuffix}`,
          ]
        );
      }

      await client.query(
        `UPDATE appointments
         SET step_code = $1, step_seq = $2, work_phase_id = $3
         WHERE id = $4`,
        [
          targetInTx.workPhaseCode,
          targetInTx.pathwayOrderIndex,
          targetInTx.id,
          appointmentId,
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('[appointments/reassign-step] transaction failed', {
        appointmentId,
        targetWorkPhaseId,
        err,
      });
      return NextResponse.json(
        { error: 'Átrendezés nem sikerült — adatbázis hiba' },
        { status: 500 }
      );
    } finally {
      client.release();
    }

    // A try-blokk minden korai exit-je ROLLBACK + return — ide csak akkor
    // jutunk el, ha a tranzakció sikeresen commit-olt, így appt/target
    // garantáltan be van állítva.
    if (!appt || !target || !appt.episodeId) {
      // Védelem typescript miatt; ide elméletileg sosem jutunk.
      return NextResponse.json({ ok: true, appointmentId });
    }

    try {
      await logActivity(
        req,
        auth.email,
        'appointment_reassigned_step',
        `Appointment ${appointmentId}: ${appt.stepCode ?? 'n/a'} (seq=${appt.stepSeq ?? 'n/a'}) → ${target.workPhaseCode} (seq=${target.pathwayOrderIndex})${reasonSuffix}`
      );
    } catch {
      /* non-blocking */
    }

    try {
      await projectRemainingSteps(appt.episodeId);
    } catch {
      /* non-blocking: a worklist újrahúzáskor magától korrigál */
    }

    try {
      await emitSchedulingEvent(
        'appointment',
        appointmentId,
        'step_reassigned'
      );
      await emitSchedulingEvent(
        'episode',
        appt.episodeId,
        'REPROJECT_INTENTS'
      );
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({
      ok: true,
      appointmentId,
      workPhaseId: target.id,
      workPhaseCode: target.workPhaseCode,
      stepSeq: target.pathwayOrderIndex,
      cleanedStaleLink: targetHasStaleLink,
      staleLinkedAppointmentId: targetHasStaleLink
        ? target.appointmentId
        : null,
      staleLinkedAppointmentStatus: targetHasStaleLink
        ? (target.linkedAppointmentStatus ?? 'nem_letezik')
        : null,
    });
  }
);
