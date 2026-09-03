/**
 * Az alkalom („vizit") és a foglalás („időpont") viszonya — puzzle v2 (094).
 *
 * „Az időpontfoglalás a váz, a tartalom a kezelési terv." Az alkalom
 * birtokolja a foglalást (episode_visits.appointment_id); a fázisok a tartalom,
 * szabadon mozgathatók, a foglalás nem megy velük. Egy alkalom nyitott
 * fázisai EGY blokk: a sorrendben első a primary, a többi alá van vonva
 * (merged_into) — a régi motorok (worklist, státusz-átmenet, projektor) a
 * primary fázis-szintű linkjén (appointment_id ↔ appointments.work_phase_id)
 * járnak, ezért a primary hordozza az alkalom foglalását.
 *
 * Minden vizit-kompozíciós mutáció (fázis be/ki/törlés, időpont hozzá-
 * rendelés/leválasztás) után a `syncVisitAppointment` állítja helyre az
 * invariánsokat, a `normalizeVisitOrder` pedig a foglalt alkalmakat időrendbe
 * „pinneli" (a tervezett alkalmak a helyükön maradnak, közéjük csúsznak).
 */
import type { PoolClient } from 'pg';
import { insertWorkPhaseAudit } from './work-phase-audit';

type Queryable = Pick<PoolClient, 'query'>;

/** Aktív = foglalásként él (nem lemondott / no-show / sikertelen) — lib/active-appointment.ts mintája. */
const ACTIVE_STATUS_SQL = `(a.appointment_status IS NULL
  OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient', 'no_show', 'unsuccessful'))`;

interface VisitMemberRow {
  id: string;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  appointment_id: string | null;
  merged_into: string | null;
  work_phase_code: string;
  duration_minutes: number | null;
}

export interface SyncVisitResult {
  visitId: string;
  appointmentId: string | null;
  /** Az alkalom nyitott blokkjának primary fázisa (null = nincs nyitott tag). */
  primaryId: string | null;
  /** Hány nyitott tagot vontunk most a primary alá. */
  mergedCount: number;
  /** A vizit foglalásától ELTÉRŐ, most leválasztott (alkalom nélkül maradt) foglalások. */
  detachedAppointmentIds: string[];
  /** Az alkalom összideje percben (planned_duration_minutes vagy a nyitott tagok összege). */
  durationMinutes: number | null;
}

async function activeAppointment(
  db: Queryable,
  appointmentId: string
): Promise<{ id: string; status: string | null; workPhaseId: string | null; startTime: Date | null } | null> {
  const { rows } = await db.query(
    `SELECT a.id, a.appointment_status AS status, a.work_phase_id AS "workPhaseId", a.start_time AS "startTime"
     FROM appointments a WHERE a.id = $1 AND ${ACTIVE_STATUS_SQL}`,
    [appointmentId]
  );
  return (rows[0] as { id: string; status: string | null; workPhaseId: string | null; startTime: Date | null }) ?? null;
}

/**
 * Az alkalom invariánsainak helyreállítása (a hívó tranzakcióján belül):
 *  1. az alkalom foglalása: a meglévő, ha aktív; különben a tagok legkorábbi
 *     aktív foglalását örökli; különben NULL;
 *  2. a nyitott tagok egy blokk: az első a primary, a többi alá vonva;
 *  3. a primary hordozza az alkalom foglalását (appointment_id + status
 *     scheduled + appointments.work_phase_id); a többi nyitott tag saját
 *     eltérő foglalása leválik (alkalom nélküli időponttá lesz — nem mondjuk le);
 *  4. tartalom nélküli foglalt alkalomnál a foglalás work_phase_id-je NULL.
 * Teljesített / kihagyott tagokat és lezárt (completed) foglalást nem bántunk.
 */
export async function syncVisitAppointment(
  client: Queryable,
  episodeId: string,
  visitId: string,
  changedBy: string
): Promise<SyncVisitResult | null> {
  const visitRow = await client.query(
    `SELECT id, appointment_id, planned_duration_minutes FROM episode_visits
     WHERE id = $1 AND episode_id = $2 FOR UPDATE`,
    [visitId, episodeId]
  );
  if (visitRow.rows.length === 0) return null;
  const visit = visitRow.rows[0] as {
    id: string;
    appointment_id: string | null;
    planned_duration_minutes: number | null;
  };

  // (FOR UPDATE mellett window-függvény nem használható — a sorrendet az ORDER BY adja.)
  const memberRows = await client.query(
    `SELECT e.id, e.status, e.appointment_id, e.merged_into_episode_work_phase_id AS merged_into,
            e.work_phase_code, e.duration_minutes
     FROM episode_work_phases e
     WHERE e.visit_id = $1 AND e.episode_id = $2
     ORDER BY COALESCE(e.seq, e.pathway_order_index), e.pathway_order_index, e.id
     FOR UPDATE OF e`,
    [visitId, episodeId]
  );
  const members = memberRows.rows as unknown as VisitMemberRow[];
  const memberIds = new Set(members.map((m) => m.id));
  const open = members.filter((m) => m.status === 'pending' || m.status === 'scheduled');

  // 1) Az alkalom foglalása.
  let appointmentId: string | null = null;
  let appointment: Awaited<ReturnType<typeof activeAppointment>> = null;
  if (visit.appointment_id) {
    appointment = await activeAppointment(client, visit.appointment_id);
    if (appointment) appointmentId = appointment.id;
  }
  if (!appointmentId) {
    const candidateIds = members.map((m) => m.appointment_id).filter((x): x is string => !!x);
    if (candidateIds.length > 0) {
      const { rows } = await client.query(
        `SELECT a.id, a.appointment_status AS status, a.work_phase_id AS "workPhaseId", a.start_time AS "startTime"
         FROM appointments a
         WHERE a.id = ANY($1::uuid[]) AND ${ACTIVE_STATUS_SQL}
         ORDER BY a.start_time NULLS LAST, a.id
         LIMIT 1`,
        [candidateIds]
      );
      if (rows[0]) {
        appointment = rows[0] as NonNullable<typeof appointment>;
        appointmentId = appointment.id;
      }
    }
  }
  if ((appointmentId ?? null) !== (visit.appointment_id ?? null)) {
    await client.query(`UPDATE episode_visits SET appointment_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [
      appointmentId,
      visitId,
    ]);
  }
  // Lezárt (completed) foglalás = történet: a fázis-linkeket nem írjuk át.
  const appointmentIsOpen = !!appointment && appointment.status == null;

  // 2) Nyitott blokk: primary + alá vont tagok.
  const primary = open[0] ?? null;
  let mergedCount = 0;
  if (primary) {
    if (primary.merged_into) {
      await client.query(
        `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = NULL WHERE id = $1`,
        [primary.id]
      );
    }
    for (const m of open.slice(1)) {
      if (m.merged_into !== primary.id) {
        await client.query(
          `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = $1 WHERE id = $2`,
          [primary.id, m.id]
        );
        // Lánc-lapítás: a most alá vont tag saját gyerekei is a primary alá.
        await client.query(
          `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = $1
           WHERE merged_into_episode_work_phase_id = $2 AND id <> $1`,
          [primary.id, m.id]
        );
        mergedCount++;
        await insertWorkPhaseAudit(client, {
          episodeWorkPhaseId: m.id,
          episodeId,
          oldStatus: m.status,
          newStatus: m.status,
          changedBy,
          changeType: 'merge',
          reason: `Egy alkalom → egy időpont: a(z) ${primary.work_phase_code} fázissal egy blokkban`,
        });
      }
    }
  }

  // 3) Fázis-linkek: csak a primary hordozza az alkalom foglalását.
  const detachedAppointmentIds: string[] = [];
  const detachPhaseLink = async (m: VisitMemberRow, reason: string) => {
    if (!m.appointment_id) return;
    const extra = m.appointment_id;
    await client.query(
      `UPDATE episode_work_phases
       SET appointment_id = NULL,
           status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
       WHERE id = $1`,
      [m.id]
    );
    // A foglalás work_phase_id-je csak akkor nullázódik, ha ez a fázis volt rá írva.
    await client.query(`UPDATE appointments SET work_phase_id = NULL WHERE id = $1 AND work_phase_id = $2`, [
      extra,
      m.id,
    ]);
    if (extra !== appointmentId) detachedAppointmentIds.push(extra);
    if (m.status === 'scheduled') {
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: m.id,
        episodeId,
        oldStatus: 'scheduled',
        newStatus: 'pending',
        changedBy,
        reason,
      });
    }
  };

  for (const m of open) {
    if (primary && m.id === primary.id) continue;
    if (m.appointment_id) {
      await detachPhaseLink(
        m,
        m.appointment_id === appointmentId
          ? 'Az alkalom foglalását a blokk primary fázisa hordozza'
          : 'A foglalás alkalom nélkül maradt (egy alkalom = egy időpont)'
      );
    }
  }

  if (primary && appointmentId && appointmentIsOpen) {
    if (primary.appointment_id && primary.appointment_id !== appointmentId) {
      await detachPhaseLink(primary, 'A foglalás alkalom nélkül maradt (az alkalomnak már van időpontja)');
    }
    if (primary.appointment_id !== appointmentId || primary.status !== 'scheduled') {
      await client.query(
        `UPDATE episode_work_phases SET appointment_id = $1, status = 'scheduled' WHERE id = $2`,
        [appointmentId, primary.id]
      );
      if (primary.status !== 'scheduled') {
        await insertWorkPhaseAudit(client, {
          episodeWorkPhaseId: primary.id,
          episodeId,
          oldStatus: primary.status,
          newStatus: 'scheduled',
          changedBy,
          reason: 'Az alkalom időpontja a fázisra terjed (a tartalom a foglalt alkalomba került)',
        });
      }
    }
    await client.query(
      `UPDATE appointments SET work_phase_id = $1, step_code = $2, episode_id = $3
       WHERE id = $4 AND (work_phase_id IS DISTINCT FROM $1 OR episode_id IS DISTINCT FROM $3)`,
      [primary.id, primary.work_phase_code, episodeId, appointmentId]
    );
  } else if (appointmentId && appointmentIsOpen) {
    // 4) Tartalom nélküli foglalt alkalom: a foglalás ne mutasson idegen fázisra.
    if (appointment?.workPhaseId && !memberIds.has(appointment.workPhaseId)) {
      await client.query(`UPDATE appointments SET work_phase_id = NULL WHERE id = $1`, [appointmentId]);
    }
  }

  const sum = open.reduce((acc, m) => acc + Number(m.duration_minutes ?? 0), 0);
  const durationMinutes =
    visit.planned_duration_minutes != null ? Number(visit.planned_duration_minutes) : sum > 0 ? sum : null;

  return {
    visitId,
    appointmentId,
    primaryId: primary?.id ?? null,
    mergedCount,
    detachedAppointmentIds,
    durationMinutes,
  };
}

/**
 * Egy fázis kilép az alkalmából (áthelyezés / törlés előtt): a csoport-tagság
 * megszűnik, és ha ő hordozta az alkalom foglalását, a foglalás az alkalomnál
 * marad — a fázis várakozóvá válik. A forrás-alkalmat utána
 * `syncVisitAppointment` rendezi (következő tag promótálása).
 */
export async function releasePhaseFromVisit(
  client: Queryable,
  episodeId: string,
  phaseId: string,
  changedBy: string
): Promise<{ keptAppointmentId: string | null }> {
  const { rows } = await client.query(
    `SELECT e.id, e.status, e.appointment_id, e.visit_id, e.merged_into_episode_work_phase_id AS merged_into,
            v.appointment_id AS visit_appointment_id
     FROM episode_work_phases e
     LEFT JOIN episode_visits v ON v.id = e.visit_id
     WHERE e.id = $1 AND e.episode_id = $2
     FOR UPDATE OF e`,
    [phaseId, episodeId]
  );
  const row = rows[0] as
    | {
        id: string;
        status: string;
        appointment_id: string | null;
        visit_id: string | null;
        merged_into: string | null;
        visit_appointment_id: string | null;
      }
    | undefined;
  if (!row) return { keptAppointmentId: null };

  // A gyerekei önállósodnak (a forrás sync ad nekik új primary-t).
  await client.query(
    `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = NULL
     WHERE merged_into_episode_work_phase_id = $1 AND episode_id = $2`,
    [phaseId, episodeId]
  );
  if (row.merged_into) {
    await client.query(`UPDATE episode_work_phases SET merged_into_episode_work_phase_id = NULL WHERE id = $1`, [
      phaseId,
    ]);
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: phaseId,
      episodeId,
      oldStatus: row.status,
      newStatus: row.status,
      changedBy,
      changeType: 'unmerge',
      reason: 'Kilépett az alkalom blokkjából (a tartalom mozog, az időpont marad)',
    });
  }

  const owned = !!row.appointment_id && !!row.visit_id && row.appointment_id === row.visit_appointment_id;
  if (!owned) return { keptAppointmentId: null };

  await client.query(
    `UPDATE episode_work_phases
     SET appointment_id = NULL,
         status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
     WHERE id = $1`,
    [phaseId]
  );
  await client.query(`UPDATE appointments SET work_phase_id = NULL WHERE id = $1 AND work_phase_id = $2`, [
    row.appointment_id,
    phaseId,
  ]);
  if (row.status === 'scheduled') {
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: phaseId,
      episodeId,
      oldStatus: 'scheduled',
      newStatus: 'pending',
      changedBy,
      reason: 'Kilépett a foglalt alkalomból — az időpont az alkalomnál marad',
    });
  }
  return { keptAppointmentId: row.appointment_id };
}

/**
 * Foglalás létrejötte / összekötése után: a fázis alkalma örökli a
 * foglalást, ha még nincs neki (könnyű változat, csoport-műveletek nélkül —
 * a booking-motorok hívják a saját tranzakciójukban).
 */
export async function adoptAppointmentForPhaseVisit(
  client: Queryable,
  phaseId: string,
  appointmentId: string
): Promise<boolean> {
  const res = await client.query(
    `UPDATE episode_visits v
     SET appointment_id = $2, updated_at = CURRENT_TIMESTAMP
     FROM episode_work_phases e
     WHERE e.id = $1 AND v.id = e.visit_id
       AND (
         v.appointment_id IS NULL
         OR v.appointment_id = $2
         OR NOT EXISTS (
           SELECT 1 FROM appointments a WHERE a.id = v.appointment_id AND ${ACTIVE_STATUS_SQL}
         )
       )`,
    [phaseId, appointmentId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * A foglalt alkalmak időrendben „pinnelve": az aktuális sorrendben a foglalt
 * alkalmak által elfoglalt pozíciókat a foglalások időrendje tölti fel, a
 * tervezett (időpont nélküli) alkalmak a helyükön maradnak — így a terv
 * rácsúszik a vázra. Utána az EWP fázis-seq is a vizit-sorrendet követi.
 * Visszaadja, változott-e a sorrend.
 */
export async function normalizeVisitOrder(client: Queryable, episodeId: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT v.id, v.seq,
            CASE WHEN a.id IS NOT NULL AND ${ACTIVE_STATUS_SQL} THEN a.start_time END AS start_time
     FROM episode_visits v
     LEFT JOIN appointments a ON a.id = v.appointment_id
     WHERE v.episode_id = $1
     ORDER BY v.seq, v.created_at, v.id
     FOR UPDATE OF v`,
    [episodeId]
  );
  const visits = rows as Array<{ id: string; seq: number; start_time: Date | string | null }>;
  const bookedPositions: number[] = [];
  const booked: Array<{ id: string; t: number }> = [];
  visits.forEach((v, i) => {
    if (v.start_time) {
      bookedPositions.push(i);
      booked.push({ id: v.id, t: new Date(v.start_time).getTime() });
    }
  });
  booked.sort((a, b) => a.t - b.t);
  const ordered = visits.map((v) => v.id);
  bookedPositions.forEach((pos, k) => {
    ordered[pos] = booked[k].id;
  });
  const changed = ordered.some((id, i) => id !== visits[i].id || visits[i].seq !== i);
  if (!changed) return false;

  for (let i = 0; i < ordered.length; i++) {
    await client.query(`UPDATE episode_visits SET seq = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [
      i,
      ordered[i],
    ]);
  }
  await renumberPhasesByVisitOrder(client, episodeId);
  return true;
}

/** Az EWP fázis-sorrend (a motorok igazsága) a vizit-sorrendet követi. */
export async function renumberPhasesByVisitOrder(
  client: Queryable,
  episodeId: string,
  lastPhaseId?: string | null
): Promise<void> {
  await client.query(
    `WITH ordered AS (
       SELECT e.id,
              ROW_NUMBER() OVER (
                ORDER BY v.seq NULLS LAST,
                         CASE WHEN $2::uuid IS NOT NULL AND (e.id = $2::uuid OR e.merged_into_episode_work_phase_id = $2::uuid)
                              THEN 1 ELSE 0 END,
                         COALESCE(e.seq, e.pathway_order_index),
                         e.pathway_order_index, e.id
              ) - 1 AS new_seq
       FROM episode_work_phases e
       LEFT JOIN episode_visits v ON e.visit_id = v.id
       WHERE e.episode_id = $1
     )
     UPDATE episode_work_phases SET seq = ordered.new_seq
     FROM ordered WHERE episode_work_phases.id = ordered.id`,
    [episodeId, lastPhaseId ?? null]
  );
}

export interface UnattachedAppointmentRow {
  id: string;
  startTime: string | null;
  endTime: string | null;
  pool: string | null;
  stepCode: string | null;
  dentistEmail: string | null;
  appointmentStatus: string | null;
}

/**
 * A beteg jövőbeli, aktív foglalásai, amelyek egyetlen alkalomhoz sem
 * tartoznak (epizód nélküli portál-foglalás, vagy a tartalom-mozgatásnál
 * leválasztott időpont) — a vázhoz rendelhető szabad időpontok.
 */
export async function listUnattachedAppointments(
  db: Queryable,
  episodeId: string
): Promise<UnattachedAppointmentRow[]> {
  const { rows } = await db.query(
    `SELECT a.id,
            COALESCE(a.start_time, ats.start_time) AS "startTime",
            COALESCE(a.end_time, ats.start_time + (COALESCE(ats.duration_minutes, 30) || ' minutes')::interval) AS "endTime",
            a.pool, a.step_code AS "stepCode", a.dentist_email AS "dentistEmail",
            a.appointment_status AS "appointmentStatus"
     FROM appointments a
     JOIN patient_episodes pe ON pe.id = $1
     LEFT JOIN available_time_slots ats ON ats.id = a.time_slot_id
     WHERE a.patient_id = pe.patient_id
       AND (a.episode_id IS NULL OR a.episode_id = $1)
       AND ${ACTIVE_STATUS_SQL}
       AND a.appointment_status IS NULL
       AND COALESCE(a.start_time, ats.start_time) > CURRENT_TIMESTAMP - INTERVAL '1 day'
       AND NOT EXISTS (SELECT 1 FROM episode_visits v WHERE v.appointment_id = a.id)
     ORDER BY COALESCE(a.start_time, ats.start_time) ASC
     LIMIT 30`,
    [episodeId]
  );
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : v != null ? String(v) : null);
    return {
      id: String(row.id),
      startTime: toIso(row.startTime),
      endTime: toIso(row.endTime),
      pool: row.pool != null ? String(row.pool) : null,
      stepCode: row.stepCode != null ? String(row.stepCode) : null,
      dentistEmail: row.dentistEmail != null ? String(row.dentistEmail) : null,
      appointmentStatus: row.appointmentStatus != null ? String(row.appointmentStatus) : null,
    };
  });
}
