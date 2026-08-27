import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import {
  EPISODE_WORK_PHASE_SELECT_COLUMNS,
  getToothTreatmentJoin,
  getToothTreatmentSelectCols,
} from '@/lib/episode-work-phase-select';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT } from '@/lib/active-appointment';
import { insertWorkPhaseTombstones, releaseWorkPhasesForDelete } from '@/lib/work-phase-delete';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/episodes/:id/work-phases/:workPhaseId
 *
 * A kezelési tervből bármelyik munkafázis elhagyható — státusztól függetlenül
 * (pending / scheduled / completed / skipped). Ha a fázishoz foglalt időpont
 * vagy nyitott slot intent tartozik, azok a törléssel egy tranzakcióban
 * lemondásra / lezárásra kerülnek (lib/work-phase-delete.ts).
 *
 * Összevont (merged) blokk szülőjének törlésekor a gyerek-fázisok nem tűnnek
 * el: az FK ON DELETE SET NULL miatt önálló terv-sorként maradnak, és külön
 * törölhetők.
 */
export const DELETE = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const workPhaseId = params.workPhaseId;
  const pool = getDbPool();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query(
      `SELECT ewp.id, ewp.episode_id, ewp.work_phase_code, ewp.status,
              pe.status as episode_status
       FROM episode_work_phases ewp
       JOIN patient_episodes pe ON ewp.episode_id = pe.id
       WHERE ewp.id = $1 AND ewp.episode_id = $2
       FOR UPDATE OF ewp`,
      [workPhaseId, episodeId]
    );

    if (row.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Munkafázis nem található' }, { status: 404 });
    }

    const phase = row.rows[0];

    if (phase.episode_status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Csak aktív epizód munkafázisai törölhetők' }, { status: 400 });
    }

    // Foglalt időpont / nyitott intent / párhuzamos plan item felszabadítása,
    // hogy bármely státuszú sor törölhető legyen.
    const released = await releaseWorkPhasesForDelete(client, episodeId, [
      { id: workPhaseId, workPhaseCode: phase.work_phase_code ?? null },
    ]);

    // Tombstone audit sor — a snapshot oszlopok miatt a DELETE ELŐTT kell
    // beszúrni; a 084-es migráció óta a sor a törlést túléli
    // (episode_work_phase_id → NULL).
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: workPhaseId,
      episodeId,
      oldStatus: phase.status,
      newStatus: 'deleted',
      changedBy: auth.email ?? auth.userId ?? 'unknown',
      reason:
        released.cancelledAppointments > 0
          ? `Manuálisan törölve (${released.cancelledAppointments} foglalás lemondva)`
          : 'Manuálisan törölve',
    });

    // Törlés-tombstone (WP-0.7, kódaudit #01): a kulcs feljegyzése + a
    // fog-fázis tooth_treatments sorának visszaállítása 'pending'-re, hogy a
    // generate (sablon-őr / fog-szinkron) ne támassza fel a törölt sort.
    // A DELETE ELŐTT kell futnia — az élő sorból olvassa a kulcsokat.
    await insertWorkPhaseTombstones(client, episodeId, [workPhaseId], auth.email ?? auth.userId ?? 'unknown');

    await client.query(`DELETE FROM episode_work_phases WHERE id = $1`, [workPhaseId]);

    await client.query(
      `WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY COALESCE(seq, pathway_order_index)) - 1 as new_seq
        FROM episode_work_phases WHERE episode_id = $1
      )
      UPDATE episode_work_phases SET seq = numbered.new_seq
      FROM numbered WHERE episode_work_phases.id = numbered.id`,
      [episodeId]
    );

    await client.query('COMMIT');

    try {
      await projectRemainingSteps(episodeId);
    } catch {
      /* non-blocking */
    }
    try {
      await emitSchedulingEvent('episode', episodeId, 'step_deleted');
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({
      deleted: true,
      workPhaseId,
      cancelledAppointments: released.cancelledAppointments,
      expiredIntents: released.expiredIntents,
    });
  } catch (txError) {
    await client.query('ROLLBACK').catch(() => {});
    throw txError;
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/episodes/:id/work-phases/:workPhaseId
 */
export const PATCH = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const workPhaseId = params.workPhaseId;
  const body = await req.json();
  const {
    status: newStatus,
    reason,
    defaultDaysOffset,
    durationMinutes,
    customLabel,
    /**
     * Utólagos teljesítés: a kliensk megadhatja, mikor készült el ténylegesen
     * a fázis (pl. egy régebbi foglalt időpont alapján). Ha hiányzik vagy
     * újranyitásnál nem alkalmazandó, esik vissza a CURRENT_TIMESTAMP-re.
     */
    completedAt: completedAtRaw,
    /**
     * Opcionális: melyik régebbi appointment alapján rögzítjük a teljesítést
     * (audit / nyomonkövetés). FK-ja az appointments táblára mutat.
     */
    appointmentId: completedAppointmentId,
  } = body;

  const pool = getDbPool();

  const isTimingOnly =
    newStatus === undefined &&
    (defaultDaysOffset !== undefined || durationMinutes !== undefined || customLabel !== undefined);

  const client = await pool.connect();
  // Skip ágon: hány jövőbeli foglalást mondtunk le (a válaszban visszaadjuk).
  let skipCancelledAppointments: number | null = null;
  try {
    await client.query('BEGIN');
    const phaseRow = await client.query(
      `SELECT ewp.id, ewp.episode_id, ewp.work_phase_code, ewp.status, ewp.pathway_order_index,
              pe.status as episode_status
       FROM episode_work_phases ewp
       JOIN patient_episodes pe ON ewp.episode_id = pe.id
       WHERE ewp.id = $1 AND ewp.episode_id = $2
       FOR UPDATE OF ewp`,
      [workPhaseId, episodeId]
    );

    if (phaseRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Munkafázis nem található' }, { status: 404 });
    }

    const phase = phaseRow.rows[0];

    if (phase.episode_status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Csak aktív epizód munkafázisai módosíthatók' }, { status: 400 });
    }

    if (isTimingOnly) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let pi = 1;

      if (typeof defaultDaysOffset === 'number' && defaultDaysOffset >= 0) {
        sets.push(`default_days_offset = $${pi++}`);
        vals.push(defaultDaysOffset);
      }
      if (typeof durationMinutes === 'number' && durationMinutes > 0) {
        sets.push(`duration_minutes = $${pi++}`);
        vals.push(durationMinutes);
      }
      if (typeof customLabel === 'string') {
        sets.push(`custom_label = $${pi++}`);
        vals.push(customLabel.trim() || null);
      }

      if (sets.length > 0) {
        vals.push(workPhaseId);
        await client.query(`UPDATE episode_work_phases SET ${sets.join(', ')} WHERE id = $${pi}`, vals);
      }

      await client.query('COMMIT');

      try {
        await emitSchedulingEvent('episode', episodeId, 'step_timing_updated');
      } catch {
        /* non-blocking */
      }
    } else if (phase.status === 'completed' && newStatus === 'pending') {
      if (typeof reason !== 'string' || reason.trim().length < 5) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Az újranyitáshoz indoklás szükséges (legalább 5 karakter).' },
          { status: 400 }
        );
      }

      const stepCode = phase.work_phase_code as string;

      await client.query(
        `UPDATE episode_work_phases SET status = 'pending', completed_at = NULL WHERE id = $1`,
        [workPhaseId]
      );

      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: workPhaseId,
        episodeId,
        oldStatus: 'completed',
        newStatus: 'pending',
        changedBy: auth.email ?? auth.userId ?? 'unknown',
        reason: reason.trim(),
      });

      // WP-0.8 kiegészítés (a WP-0.4 review-jából): a párosítás ELSŐDLEGESEN
      // work_phase_id szerint megy (erre az EWP sorra), step_code szerint csak
      // a work_phase_id NÉLKÜLI legacy sorokra — a skip-ág pontos mintájára.
      // Csupasz step_code duplikált fáziskódnál (két állcsont / több fog) a
      // TESTVÉR fázis foglalását is lemondaná.
      const futureAppts = await client.query(
        `SELECT a.id, a.time_slot_id, a.slot_intent_id FROM appointments a
         WHERE a.episode_id = $1
           AND a.start_time > CURRENT_TIMESTAMP
           AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
           AND (
             a.work_phase_id = $2
             OR (a.work_phase_id IS NULL AND a.step_code = $3)
           )
         FOR UPDATE OF a`,
        [episodeId, workPhaseId, stepCode]
      );
      for (const ap of futureAppts.rows as Array<{
        id: string;
        time_slot_id: string | null;
        slot_intent_id: string | null;
      }>) {
        // A lemondott sor a slot_intent linket is elengedi (WP-0.4 mintája),
        // hogy a halott appointment ne birtokolja tovább az intentet
        // (idx_appointments_unique_slot_intent).
        await client.query(
          `UPDATE appointments SET appointment_status = 'cancelled_by_doctor', slot_intent_id = NULL WHERE id = $1`,
          [ap.id]
        );
        if (ap.time_slot_id) {
          await client.query(
            `UPDATE available_time_slots SET state = 'free', status = 'available' WHERE id = $1`,
            [ap.time_slot_id]
          );
        }
        // A lemondott foglaláshoz tartozó konvertált intent lejáratása — a
        // skip-ág pontos mintájára; e nélkül a 'converted' intent egy
        // lemondott appointmentre mutatna tovább, és a projektor nem tudná
        // újranyitni a lépést.
        if (ap.slot_intent_id) {
          await client.query(
            `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND state = 'converted'`,
            [ap.slot_intent_id]
          );
        }
      }

      // Nyitott intentek lejáratása — szintén erre a fázisra szűkítve:
      // work_phase_id szerint, step_code-dal csak a legacy (link nélküli)
      // sorokra. A testvér-fázis nyitott intentje érintetlen marad.
      await client.query(
        `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE episode_id = $1 AND state = 'open'
           AND (work_phase_id = $2 OR (work_phase_id IS NULL AND step_code = $3))`,
        [episodeId, workPhaseId, stepCode]
      );

      await client.query('COMMIT');

      try {
        await projectRemainingSteps(episodeId);
      } catch {
        /* non-blocking */
      }
      try {
        await emitSchedulingEvent('episode', episodeId, 'step_reopened');
      } catch {
        /* non-blocking */
      }

      const ttJoin = getToothTreatmentJoin();
      const ttCols = getToothTreatmentSelectCols();
      const updated = await client.query(
        `SELECT ${EPISODE_WORK_PHASE_SELECT_COLUMNS}${ttCols} FROM episode_work_phases ewp ${ttJoin} WHERE ewp.id = $1`,
        [workPhaseId]
      );

      return NextResponse.json({ workPhase: updated.rows[0] });
    } else {
      const validTransitions: Record<string, string[]> = {
        pending: ['skipped', 'completed'],
        scheduled: ['skipped', 'completed'],
        skipped: ['pending'],
        completed: [],
      };

      const allowed = validTransitions[phase.status];
      if (!allowed || !allowed.includes(newStatus)) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Nem lehetséges: ${phase.status} → ${newStatus}`,
            currentStatus: phase.status,
            allowedTransitions: allowed ?? [],
          },
          { status: 400 }
        );
      }

      // `completedAt` opcionális override — utólagos teljesítésnél (pl. ha egy
      // régebbi foglalt időpontnál készült el a fázis) a kliens megadhatja.
      // Validáljuk: érvényes ISO és nem jövőbeli. Ha hiányzik vagy érvénytelen,
      // marad a CURRENT_TIMESTAMP fallback.
      let completedAt: string | null = null;
      if (newStatus === 'skipped' || newStatus === 'completed') {
        completedAt = new Date().toISOString();
        if (newStatus === 'completed' && typeof completedAtRaw === 'string' && completedAtRaw.length > 0) {
          const parsed = new Date(completedAtRaw);
          if (Number.isNaN(parsed.getTime())) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              { error: 'completedAt érvénytelen dátum (ISO szöveg szükséges).' },
              { status: 400 }
            );
          }
          if (parsed.getTime() > Date.now() + 60_000) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              { error: 'completedAt nem lehet jövőbeli időpont.' },
              { status: 400 }
            );
          }
          completedAt = parsed.toISOString();
        }
      }

      // Opcionális: a megadott korábbi appointment-et kötjük az episode_work_phases-hoz
      // (a meglévő appointment_id mező). Egyezzen a beteg + ne legyen jövőbeli, és
      // hagyjuk érintetlenül, ha nem lett megadva (pl. egyéni dátum esetén).
      let appointmentIdForLink: string | null | undefined = undefined;
      if (newStatus === 'completed' && typeof completedAppointmentId === 'string' && completedAppointmentId.length > 0) {
        const apptCheck = await client.query(
          `SELECT a.id, a.patient_id, ats.start_time
           FROM appointments a
           JOIN available_time_slots ats ON a.time_slot_id = ats.id
           WHERE a.id = $1`,
          [completedAppointmentId]
        );
        if (apptCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'A megadott appointment nem található.' },
            { status: 400 }
          );
        }
        const epPatient = await client.query(
          `SELECT patient_id FROM patient_episodes WHERE id = $1`,
          [episodeId]
        );
        if (
          epPatient.rows.length === 0 ||
          epPatient.rows[0].patient_id !== apptCheck.rows[0].patient_id
        ) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'A megadott appointment nem ehhez a beteghez tartozik.' },
            { status: 400 }
          );
        }
        appointmentIdForLink = completedAppointmentId;
      }

      if (appointmentIdForLink !== undefined) {
        await client.query(
          `UPDATE episode_work_phases
           SET status = $1, completed_at = $2, appointment_id = $3
           WHERE id = $4`,
          [newStatus, completedAt, appointmentIdForLink, workPhaseId]
        );
      } else if (newStatus === 'skipped' || phase.status === 'skipped') {
        // Skip és skipped → pending visszaút: a foglalás-link mindig tisztul.
        // A jövőbeli foglalást a lenti felszabadítás mondja le; a múltbeli
        // (már megtörtént) vizitet nem bántjuk, csak a link kerül le a sorról.
        await client.query(
          `UPDATE episode_work_phases SET status = $1, completed_at = $2, appointment_id = NULL WHERE id = $3`,
          [newStatus, completedAt, workPhaseId]
        );
      } else {
        await client.query(
          `UPDATE episode_work_phases SET status = $1, completed_at = $2 WHERE id = $3`,
          [newStatus, completedAt, workPhaseId]
        );
      }

      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: workPhaseId,
        episodeId,
        oldStatus: phase.status,
        newStatus,
        changedBy: auth.email ?? auth.userId ?? 'unknown',
        reason: reason ?? null,
      });

      // Skip ág: a fázisra mutató JÖVŐBELI aktív foglalások lemondása és a
      // slot/intent felszabadítása. Csak a jövőbeli sorokat bántjuk: a skip
      // legitim retro-használata (már megtörtént vizit) érintetlen marad.
      //
      // Párosítás ELSŐDLEGESEN work_phase_id szerint (a skip-elt EWP sorra),
      // és step_code szerint CSAK a work_phase_id NÉLKÜLI legacy sorokra —
      // a lib/work-phase-delete.ts mintája. Puszta step_code-ra szűrni nem
      // szabad: egy epizódban több azonos work_phase_code-ú testvér-fázis is
      // élhet (két állcsont / több fog), és a testvér foglalását nem szabad
      // lemondani. A FOR UPDATE a párhuzamos intent→appointment konverzióval
      // szembeni ablakot szűkíti.
      if (newStatus === 'skipped') {
        const stepCode = (phase.work_phase_code as string | null) ?? null;
        const futureAppts = await client.query(
          `SELECT a.id, a.time_slot_id, a.slot_intent_id FROM appointments a
           WHERE a.episode_id = $1
             AND a.start_time > CURRENT_TIMESTAMP
             AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
             AND (
               a.work_phase_id = $2
               OR (a.work_phase_id IS NULL AND a.step_code = $3)
             )
           FOR UPDATE OF a`,
          [episodeId, workPhaseId, stepCode]
        );
        for (const ap of futureAppts.rows as Array<{
          id: string;
          time_slot_id: string | null;
          slot_intent_id: string | null;
        }>) {
          // WP-0.4 (kódaudit #03): a lemondott sor a slot_intent linket is
          // elengedi, hogy a halott appointment ne birtokolja tovább az
          // intentet (idx_appointments_unique_slot_intent). Az intent
          // lejáratása lentebb a már kiolvasott `ap.slot_intent_id`-vel megy.
          await client.query(
            `UPDATE appointments SET appointment_status = 'cancelled_by_doctor', slot_intent_id = NULL WHERE id = $1`,
            [ap.id]
          );
          if (ap.time_slot_id) {
            await client.query(
              `UPDATE available_time_slots SET state = 'free', status = 'available' WHERE id = $1`,
              [ap.time_slot_id]
            );
          }
          // A lemondott foglaláshoz tartozó konvertált intent lejáratása —
          // ugyanaz, mint az appointments/[id]/status lemondási ágán; e nélkül
          // a 'converted' intent egy lemondott appointmentre mutatna tovább.
          if (ap.slot_intent_id) {
            await client.query(
              `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
               WHERE id = $1 AND state = 'converted'`,
              [ap.slot_intent_id]
            );
          }
        }

        // Nyitott intentek lejáratása — szintén a skip-elt fázisra szűkítve:
        // work_phase_id szerint, step_code-dal csak a legacy (link nélküli)
        // sorokra. A testvér-fázis nyitott intentje érintetlen marad.
        await client.query(
          `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
           WHERE episode_id = $1 AND state = 'open'
             AND (work_phase_id = $2 OR (work_phase_id IS NULL AND step_code = $3))`,
          [episodeId, workPhaseId, stepCode]
        );

        skipCancelledAppointments = futureAppts.rows.length;
      }

      await client.query('COMMIT');

      if (newStatus === 'skipped' || phase.status === 'skipped') {
        try {
          await projectRemainingSteps(episodeId);
        } catch {
          /* non-blocking */
        }
      }

      try {
        await emitSchedulingEvent(
          'episode',
          episodeId,
          newStatus === 'completed' ? 'step_completed' : 'step_skipped'
        );
      } catch {
        /* non-blocking */
      }
    }

    const ttJoin = getToothTreatmentJoin();
    const ttCols = getToothTreatmentSelectCols();
    const updated = await client.query(
      `SELECT ${EPISODE_WORK_PHASE_SELECT_COLUMNS}${ttCols} FROM episode_work_phases ewp ${ttJoin} WHERE ewp.id = $1`,
      [workPhaseId]
    );

    return NextResponse.json({
      workPhase: updated.rows[0],
      ...(skipCancelledAppointments !== null ? { cancelledAppointments: skipCancelledAppointments } : {}),
    });
  } catch (txError) {
    await client.query('ROLLBACK').catch(() => {});
    throw txError;
  } finally {
    client.release();
  }
});
