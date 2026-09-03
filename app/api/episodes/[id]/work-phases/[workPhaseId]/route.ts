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
import {
  hasVisitAppointmentColumn,
  normalizeVisitOrder,
  releasePhaseFromVisit,
  renumberPhasesByVisitOrder,
  syncVisitAppointment,
} from '@/lib/visit-appointment-sync';

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
    // 094 előtti sémán (deploy migráció előtt) nincs vizit-időpont oszlop.
    const hasVisitAppt = await hasVisitAppointmentColumn(client);
    const row = await client.query(
      `SELECT ewp.id, ewp.episode_id, ewp.work_phase_code, ewp.status, ewp.visit_id,
              ewp.appointment_id, ${hasVisitAppt ? 'v.appointment_id' : 'NULL::uuid'} AS visit_appointment_id,
              pe.status as episode_status
       FROM episode_work_phases ewp
       JOIN patient_episodes pe ON ewp.episode_id = pe.id
       LEFT JOIN episode_visits v ON v.id = ewp.visit_id
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

    // Puzzle v2 (094): „az időpontfoglalás a váz" — ha a fázis az alkalma
    // foglalását hordozza, a foglalás az ALKALOMNÁL marad (üres, de foglalt
    // alkalom); a fázis csak kilép belőle. A lemondás az alkalom törlésének
    // dolga. Idegen (nem az alkalomé) foglalásnál a régi szabály: lemondás.
    const changedBy = auth.email ?? auth.userId ?? 'unknown';
    const { keptAppointmentId } = await releasePhaseFromVisit(client, episodeId, workPhaseId, changedBy);

    // Foglalt időpont / nyitott intent / párhuzamos plan item felszabadítása,
    // hogy bármely státuszú sor törölhető legyen.
    const released = await releaseWorkPhasesForDelete(
      client,
      episodeId,
      [{ id: workPhaseId, workPhaseCode: phase.work_phase_code ?? null }],
      { keepAppointmentIds: keptAppointmentId ? [keptAppointmentId] : [] }
    );

    // Tombstone audit sor — a snapshot oszlopok miatt a DELETE ELŐTT kell
    // beszúrni; a 084-es migráció óta a sor a törlést túléli
    // (episode_work_phase_id → NULL).
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: workPhaseId,
      episodeId,
      oldStatus: phase.status,
      newStatus: 'deleted',
      changedBy: auth.email ?? auth.userId ?? 'unknown',
      changeType: 'delete',
      reason:
        released.cancelledAppointments > 0
          ? `Manuálisan törölve (${released.cancelledAppointments} foglalás lemondva)`
          : keptAppointmentId
            ? 'Manuálisan törölve (az időpont az alkalomnál maradt)'
            : 'Manuálisan törölve',
    });

    // Törlés-tombstone (WP-0.7, kódaudit #01): a kulcs feljegyzése + a
    // fog-fázis tooth_treatments sorának visszaállítása 'pending'-re, hogy a
    // generate (sablon-őr / fog-szinkron) ne támassza fel a törölt sort.
    // A DELETE ELŐTT kell futnia — az élő sorból olvassa a kulcsokat.
    await insertWorkPhaseTombstones(client, episodeId, [workPhaseId], auth.email ?? auth.userId ?? 'unknown');

    await client.query(`DELETE FROM episode_work_phases WHERE id = $1`, [workPhaseId]);

    // Puzzle v2: az üres alkalom NEM tűnik el automatikusan — a kiürült alkalom
    // (akár a foglalásával együtt) megmarad, kézzel törölhető. Az alkalom
    // blokkját újrarendezzük (következő tag promótálása az időpontra).
    if (phase.visit_id) {
      await syncVisitAppointment(client, episodeId, phase.visit_id as string, changedBy);
    }

    await renumberPhasesByVisitOrder(client, episodeId);

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
      keptAppointmentId,
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
    /** WP-4.2: fázis áthelyezése másik alkalomba (ugyanazon epizód vizitje). */
    visitId: targetVisitId,
    /** WP-4.2: állcsont-hatókör ('felso' | 'also' | 'mindketto' | null). */
    jaw: newJaw,
    /** WP-4.2: fog-hatókör — a teljes fogszám-lista felülírása (string[]). */
    teeth: newTeeth,
  } = body;

  const pool = getDbPool();

  const hasScopeFields =
    targetVisitId !== undefined || newJaw !== undefined || newTeeth !== undefined;

  // Review-javítás (WP-4.2): a státusz-váltás és a hatókör/vizit-módosítás
  // külön hívás — kombinálva a hatókör-mezők némán elvesznének a státusz-ágon.
  if (newStatus !== undefined && hasScopeFields) {
    return NextResponse.json(
      {
        error:
          'A státusz-váltás és a vizit/hatókör-módosítás (visitId, jaw, teeth) külön kérésben küldendő',
      },
      { status: 400 }
    );
  }
  if (targetVisitId !== undefined && typeof targetVisitId !== 'string') {
    return NextResponse.json({ error: 'A visitId string azonosító legyen' }, { status: 400 });
  }

  const isTimingOnly =
    newStatus === undefined &&
    (defaultDaysOffset !== undefined ||
      durationMinutes !== undefined ||
      customLabel !== undefined ||
      hasScopeFields);

  const client = await pool.connect();
  // Skip ágon: hány jövőbeli foglalást mondtunk le (a válaszban visszaadjuk).
  let skipCancelledAppointments: number | null = null;
  // Vizit-áthelyezésnél a COMMIT után újravetítünk (seq-átszámozás → intent-kulcsok).
  let visitMoved = false;
  try {
    await client.query('BEGIN');
    const phaseRow = await client.query(
      `SELECT ewp.id, ewp.episode_id, ewp.work_phase_code, ewp.status, ewp.pathway_order_index,
              ewp.duration_minutes, ewp.default_days_offset, ewp.custom_label,
              ewp.visit_id, ewp.jaw, ewp.merged_into_episode_work_phase_id, ewp.appointment_id,
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
      // WP-2.1: a ténylegesen változó mezők ember-olvasható listája az audit
      // reason-jébe — a no-op UPDATE (azonos érték) nem termel napló-sort.
      const auditChanges: string[] = [];
      let pi = 1;

      if (typeof defaultDaysOffset === 'number' && defaultDaysOffset >= 0) {
        sets.push(`default_days_offset = $${pi++}`);
        vals.push(defaultDaysOffset);
        if (defaultDaysOffset !== phase.default_days_offset) {
          auditChanges.push(`eltolás ${phase.default_days_offset}→${defaultDaysOffset} nap`);
        }
      }
      if (typeof durationMinutes === 'number' && durationMinutes > 0) {
        sets.push(`duration_minutes = $${pi++}`);
        vals.push(durationMinutes);
        if (durationMinutes !== phase.duration_minutes) {
          auditChanges.push(`időtartam ${phase.duration_minutes}→${durationMinutes} perc`);
        }
      }
      if (typeof customLabel === 'string') {
        sets.push(`custom_label = $${pi++}`);
        const newLabel = customLabel.trim() || null;
        vals.push(newLabel);
        if (newLabel !== (phase.custom_label ?? null)) {
          auditChanges.push(`címke „${phase.custom_label ?? '—'}” → „${newLabel ?? '—'}”`);
        }
      }

      if (sets.length > 0) {
        vals.push(workPhaseId);
        await client.query(`UPDATE episode_work_phases SET ${sets.join(', ')} WHERE id = $${pi}`, vals);
      }

      if (auditChanges.length > 0) {
        await insertWorkPhaseAudit(client, {
          episodeWorkPhaseId: workPhaseId,
          episodeId,
          oldStatus: phase.status,
          newStatus: phase.status,
          changedBy: auth.email ?? auth.userId ?? 'unknown',
          changeType: 'timing_change',
          reason: `Időzítés/címke módosítva: ${auditChanges.join(', ')}`,
        });
      }

      // ─── WP-4.2 / Puzzle v2: áthelyezés másik alkalomba ──────────────────
      if (typeof targetVisitId === 'string' && targetVisitId !== phase.visit_id) {
        const targetVisit = await client.query(
          `SELECT id FROM episode_visits WHERE id = $1 AND episode_id = $2 FOR UPDATE`,
          [targetVisitId, episodeId]
        );
        if (targetVisit.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'A cél-alkalom nem található ebben az epizódban', code: 'VISIT_NOT_FOUND' },
            { status: 404 }
          );
        }
        const changedBy = auth.email ?? auth.userId ?? 'unknown';
        // „Az időpontfoglalás a váz, a tartalom a kezelési terv": CSAK ez a
        // fázis költözik. A forrás-alkalom időpontja a helyén marad (a fázis
        // várakozóvá válik), az alá vont tagjai a forrásban maradnak és egy
        // következő tag lép a primary helyére; a cél-alkalomban a fázis a
        // blokk része lesz — ha a célnak van időpontja, a tartalom rácsúszik.
        const { keptAppointmentId } = await releasePhaseFromVisit(client, episodeId, workPhaseId, changedBy);
        await client.query(`UPDATE episode_work_phases SET visit_id = $1 WHERE id = $2`, [
          targetVisitId,
          workPhaseId,
        ]);
        // A sorrend igazsága az EWP COALESCE(seq, pathway_order_index): az
        // áthelyezett sor a cél-alkalom VÉGÉRE kerül (az optimista kliens is
        // ezt rajzolja).
        await renumberPhasesByVisitOrder(client, episodeId, workPhaseId);
        if (phase.visit_id) {
          await syncVisitAppointment(client, episodeId, phase.visit_id as string, changedBy);
        }
        const targetSync = await syncVisitAppointment(client, episodeId, targetVisitId, changedBy);
        // A célalkalom örökölhette a fázis saját (nem alkalom-tulajdonú)
        // foglalását → a foglalt alkalmak időrendje igazodik.
        await normalizeVisitOrder(client, episodeId);
        visitMoved = true;
        await insertWorkPhaseAudit(client, {
          episodeWorkPhaseId: workPhaseId,
          episodeId,
          oldStatus: phase.status,
          newStatus: phase.status,
          changedBy,
          changeType: 'visit_change',
          reason: keptAppointmentId
            ? 'Áthelyezve másik alkalomba (az időpont az előző alkalomnál maradt)'
            : targetSync?.appointmentId
              ? 'Áthelyezve másik alkalomba (a cél-alkalom időpontjára)'
              : 'Áthelyezve másik alkalomba',
        });
      }

      // ─── WP-4.2: állcsont-hatókör ───────────────────────────────────────
      if (newJaw !== undefined) {
        if (newJaw !== null && !['felso', 'also', 'mindketto'].includes(newJaw)) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: "A jaw értéke 'felso' | 'also' | 'mindketto' | null lehet" },
            { status: 400 }
          );
        }
        if ((newJaw ?? null) !== (phase.jaw ?? null)) {
          await client.query(`UPDATE episode_work_phases SET jaw = $1 WHERE id = $2`, [
            newJaw,
            workPhaseId,
          ]);
          await insertWorkPhaseAudit(client, {
            episodeWorkPhaseId: workPhaseId,
            episodeId,
            oldStatus: phase.status,
            newStatus: phase.status,
            changedBy: auth.email ?? auth.userId ?? 'unknown',
            changeType: 'scope_change',
            reason: `Állcsont-hatókör: ${phase.jaw ?? '—'} → ${newJaw ?? '—'}`,
          });
        }
      }

      // ─── WP-4.2: fog-hatókör (a teljes lista felülírása) ────────────────
      if (newTeeth !== undefined) {
        if (
          !Array.isArray(newTeeth) ||
          newTeeth.some((t) => typeof t !== 'string' && typeof t !== 'number')
        ) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'A teeth fogszám-lista legyen (string[] vagy number[])' },
            { status: 400 }
          );
        }
        const teethList = Array.from(
          new Set(newTeeth.map((t: string | number) => String(t).trim().slice(0, 5)))
        ).filter((t) => t.length > 0);
        const oldTeethRows = await client.query(
          `SELECT tooth_number FROM episode_work_phase_teeth WHERE episode_work_phase_id = $1 ORDER BY tooth_number`,
          [workPhaseId]
        );
        const oldTeeth = oldTeethRows.rows.map((r: { tooth_number: string }) => r.tooth_number);
        const changed =
          oldTeeth.length !== teethList.length ||
          [...teethList].sort().join(',') !== [...oldTeeth].sort().join(',');
        if (changed) {
          await client.query(`DELETE FROM episode_work_phase_teeth WHERE episode_work_phase_id = $1`, [
            workPhaseId,
          ]);
          for (const tooth of teethList) {
            await client.query(
              `INSERT INTO episode_work_phase_teeth (episode_work_phase_id, tooth_number) VALUES ($1, $2)`,
              [workPhaseId, tooth]
            );
          }
          await insertWorkPhaseAudit(client, {
            episodeWorkPhaseId: workPhaseId,
            episodeId,
            oldStatus: phase.status,
            newStatus: phase.status,
            changedBy: auth.email ?? auth.userId ?? 'unknown',
            changeType: 'scope_change',
            reason: `Fog-hatókör: [${oldTeeth.join(', ') || '—'}] → [${teethList.join(', ') || '—'}]`,
          });
        }
      }

      await client.query('COMMIT');

      if (visitMoved) {
        try {
          await projectRemainingSteps(episodeId);
        } catch {
          /* non-blocking — a projektor a következő releváns eseménynél újrafut */
        }
      }
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
