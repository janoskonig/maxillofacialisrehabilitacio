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
 *
 * WP-6.5: az epizód alkalom nélküli, nyitott foglalásai (a naptárból fázis
 * nélkül foglalt időpontok) maguktól a tervezett alkalmakra csúsznak
 * (`slidePlanOntoAppointments`) — a kézzel leválasztott foglalást a 097-es
 * `appointments.visit_detached_at` jelöli, azt a rácsúszás kihagyja.
 */
import type { Pool, PoolClient } from 'pg';
import { insertWorkPhaseAudit } from './work-phase-audit';
import { probeColumnExists } from './schema-probe';
import { createEpisodeVisit } from './episode-visits';
import { DEFAULT_VISIT_GAP_DAYS } from './visit-plan-constants';

type Queryable = Pick<PoolClient, 'query'>;

/**
 * Séma-őr: a 094-es migráció (episode_visits.appointment_id) előtti DB-n a
 * vizit-tulajdonú időpont logikája kimarad (a blokk/primary rendezés marad),
 * hogy a deploy migráció előtt se 500-azzon — a repo probe-konvenciója
 * (lib/schema-probe.ts, folyamat-szinten cache-elt).
 */
export async function hasVisitAppointmentColumn(db: Queryable): Promise<boolean> {
  return probeColumnExists(db as PoolClient, 'episode_visits', 'appointment_id');
}

/**
 * Séma-őr a 097-es migrációra (appointments.visit_detached_at): a kézzel
 * leválasztott foglalás jelölője. Nélküle az automatikus rácsúszás kimarad
 * (különben a leválasztott időpontot a következő olvasás visszatenné).
 */
export async function hasVisitDetachedColumn(db: Queryable): Promise<boolean> {
  return probeColumnExists(db as PoolClient, 'appointments', 'visit_detached_at');
}

/** Aktív = foglalásként él (nem lemondott / no-show / sikertelen) — lib/active-appointment.ts mintája. */
const ACTIVE_STATUS_SQL = `(a.appointment_status IS NULL
  OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient', 'no_show', 'unsuccessful'))`;

/**
 * Az alkalomnak nincs élő időpontja: üres, vagy a foglalása nem aktív
 * (lemondott / no-show / sikertelen). A lezárt (completed) időpont történet —
 * az az alkalom nem vesz fel újat.
 */
const VISIT_NEEDS_APPOINTMENT_SQL = `(v.appointment_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM appointments a2
         WHERE a2.id = v.appointment_id
           AND (a2.appointment_status IS NULL OR a2.appointment_status = 'completed')
       ))`;

/**
 * A rácsúszás jelöltjei: az epizód nyitott (status NULL), nem leválasztott,
 * (nagyjából) jövőbeli foglalásai, amelyek egyetlen alkalomhoz sem tartoznak
 * — ugyanaz az idő-ablak, mint a sávé (listUnattachedAppointments). A fázishoz
 * kötött foglalás (appointments.work_phase_id vagy episode_work_phases.
 * appointment_id) csak akkor jelölt, ha a fázisának alkalma vár időpontra —
 * különben a fázisánál marad (legacy, alkalom nélküli sor; dupla foglalás
 * ugyanarra a fázisra), nem csúsztatjuk máshova.
 */
function slideCandidateSql(mode: 'lock' | 'probe'): string {
  return `SELECT a.id,
            COALESCE(a.start_time, ats.start_time) AS "startTime",
            lp.phase_id AS "linkedPhaseId",
            lp.visit_id AS "linkedVisitId"
     FROM appointments a
     LEFT JOIN available_time_slots ats ON ats.id = a.time_slot_id
     LEFT JOIN LATERAL (
       SELECT e.id AS phase_id, e.visit_id
       FROM episode_work_phases e
       WHERE e.episode_id = $1 AND (e.id = a.work_phase_id OR e.appointment_id = a.id)
       ORDER BY (e.id = a.work_phase_id) DESC, COALESCE(e.seq, e.pathway_order_index), e.id
       LIMIT 1
     ) lp ON TRUE
     WHERE a.episode_id = $1
       AND a.appointment_status IS NULL
       AND a.visit_detached_at IS NULL
       AND COALESCE(a.start_time, ats.start_time) > CURRENT_TIMESTAMP - INTERVAL '1 day'
       AND NOT EXISTS (SELECT 1 FROM episode_visits v WHERE v.appointment_id = a.id)
       AND (
         lp.phase_id IS NULL
         OR EXISTS (SELECT 1 FROM episode_visits v WHERE v.id = lp.visit_id AND ${VISIT_NEEDS_APPOINTMENT_SQL})
       )
     ORDER BY COALESCE(a.start_time, ats.start_time) ASC, a.id
     ${mode === 'lock' ? 'FOR UPDATE OF a' : 'LIMIT 1'}`;
}

interface SlideCandidateRow {
  id: string;
  startTime: Date | null;
  linkedPhaseId: string | null;
  linkedVisitId: string | null;
}

interface VisitMemberRow {
  id: string;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  appointment_id: string | null;
  merged_into: string | null;
  work_phase_code: string;
  duration_minutes: number | null;
  pathway_order_index: number | null;
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
  const hasApptCol = await hasVisitAppointmentColumn(client);
  const visitRow = await client.query(
    `SELECT id, ${hasApptCol ? 'appointment_id' : 'NULL::uuid AS appointment_id'}, planned_duration_minutes
     FROM episode_visits
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
            e.work_phase_code, e.duration_minutes, e.pathway_order_index
     FROM episode_work_phases e
     WHERE e.visit_id = $1 AND e.episode_id = $2
     ORDER BY COALESCE(e.seq, e.pathway_order_index), e.pathway_order_index, e.id
     FOR UPDATE OF e`,
    [visitId, episodeId]
  );
  const members = memberRows.rows as unknown as VisitMemberRow[];
  const memberIds = new Set(members.map((m) => m.id));
  const open = members.filter((m) => m.status === 'pending' || m.status === 'scheduled');

  // 1) Az alkalom foglalása. (094 előtti sémán nincs vizit-időpont: a fázisok
  //    saját linkjeit nem bántjuk, csak a blokkot rendezzük.)
  let appointmentId: string | null = null;
  let appointment: Awaited<ReturnType<typeof activeAppointment>> = null;
  if (visit.appointment_id) {
    appointment = await activeAppointment(client, visit.appointment_id);
    if (appointment) appointmentId = appointment.id;
  }
  if (!appointmentId && hasApptCol) {
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
  if (hasApptCol && (appointmentId ?? null) !== (visit.appointment_id ?? null)) {
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
    if (!hasApptCol) break; // 094 előtt: a fázis-linkek maradnak, ahogy vannak
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
    // A step_seq is a primary-t kövesse (pathway_order_index) — különben az
    // integritás-őr (APPOINTMENT_STEP_MISMATCH) a következő olvasáskor
    // „javítaná", felesleges audit-zajjal.
    await client.query(
      `UPDATE appointments SET work_phase_id = $1, step_code = $2, episode_id = $3, step_seq = $5
       WHERE id = $4
         AND (work_phase_id IS DISTINCT FROM $1 OR episode_id IS DISTINCT FROM $3
              OR step_code IS DISTINCT FROM $2 OR step_seq IS DISTINCT FROM $5)`,
      [primary.id, primary.work_phase_code, episodeId, appointmentId, primary.pathway_order_index]
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
  const hasApptCol = await hasVisitAppointmentColumn(client);
  const { rows } = await client.query(
    `SELECT e.id, e.status, e.appointment_id, e.visit_id, e.merged_into_episode_work_phase_id AS merged_into,
            ${hasApptCol ? 'v.appointment_id' : 'NULL::uuid'} AS visit_appointment_id
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
  if (!(await hasVisitAppointmentColumn(client))) return false;
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
  const adopted = (res.rowCount ?? 0) > 0;
  // WP-6.5: fázishoz kötött (worklist / átrendelés) foglalás újra a váz része —
  // a korábbi kézi leválasztás jelölője lejár.
  if (adopted && (await hasVisitDetachedColumn(client))) {
    await client.query(
      `UPDATE appointments SET visit_detached_at = NULL WHERE id = $1 AND visit_detached_at IS NOT NULL`,
      [appointmentId]
    );
  }
  return adopted;
}

export interface PlanSlideResult {
  /** Tervezett alkalmak, amelyek most kaptak időpontot (a párosítás sorrendjében). */
  adopted: Array<{ visitId: string; appointmentId: string; primaryId: string | null }>;
  /** Új, üres-foglalt alkalmak a tervezett alkalmakon túli időpontokból. */
  spawned: Array<{ visitId: string; appointmentId: string }>;
}

export function planSlideChanged(result: PlanSlideResult | null): boolean {
  return !!result && (result.adopted.length > 0 || result.spawned.length > 0);
}

/**
 * WP-6.5 — „A terv rácsúszik a foglalt időpontokra."
 *
 * Az epizód alkalom nélküli, nyitott, jövőbeli foglalásai (a naptárból vagy a
 * worklistből fázis nélkül foglalt időpontok) időrendben a TERVEZETT alkalmakra
 * csúsznak — azokra, amelyeknek nincs nyitott időpontjuk, és van nyitott
 * (pending/scheduled) tartalmuk vagy még üresek —, terv-sorrendben. A fázishoz kötött
 * foglalás (work_phase_id) a saját fázisának alkalmát kapja, ha az szabad.
 * A tervezett alkalmakon túli időpontokból új, üres-foglalt alkalom lesz
 * („időpont tartalom nélkül"), mert az időpont a váz. A foglalt alkalmak
 * utána időrendbe rendeződnek (normalizeVisitOrder).
 *
 * Kimarad: a kézzel leválasztott foglalás (visit_detached_at — a sáv dolga),
 * az epizód nélküli (portál) foglalás, és minden lezárt / lemondott időpont.
 * Idempotens: ha nincs jelölt, nem ír semmit. A hívó tranzakcióján belül fut;
 * NULL = a séma még nem tud róla (094/097 előtt).
 */
export async function slidePlanOntoAppointments(
  client: Queryable,
  episodeId: string,
  changedBy: string
): Promise<PlanSlideResult | null> {
  if (!(await hasVisitAppointmentColumn(client)) || !(await hasVisitDetachedColumn(client))) return null;
  const result: PlanSlideResult = { adopted: [], spawned: [] };

  // Epizódonként soros: két párhuzamos olvasás ne párosítsa kétszer ugyanazt.
  const ep = await client.query(`SELECT id, status FROM patient_episodes WHERE id = $1 FOR UPDATE`, [episodeId]);
  const episode = ep.rows[0] as { id: string; status: string } | undefined;
  if (!episode || episode.status !== 'open') return result;

  const cand = await client.query(slideCandidateSql('lock'), [episodeId]);
  const candidates = cand.rows as SlideCandidateRow[];
  if (candidates.length === 0) return result;

  // Tervezett alkalmak: nincs élő időpontjuk (üres vagy nem aktív), és van
  // nyitott tartalmuk VAGY még üresek — terv-sorrendben. A lezárt (completed)
  // időpont történet, az az alkalom nem jelölt; a csupa kész / kihagyott
  // tartalmú alkalom sem.
  const tv = await client.query(
    `SELECT v.id
     FROM episode_visits v
     WHERE v.episode_id = $1
       AND ${VISIT_NEEDS_APPOINTMENT_SQL}
       AND (
         EXISTS (
           SELECT 1 FROM episode_work_phases e
           WHERE e.visit_id = v.id AND e.status IN ('pending', 'scheduled')
         )
         OR NOT EXISTS (SELECT 1 FROM episode_work_phases e WHERE e.visit_id = v.id)
       )
     ORDER BY v.seq, v.created_at, v.id
     FOR UPDATE OF v`,
    [episodeId]
  );
  const targets = tv.rows.map((r) => String((r as { id: string }).id));

  const freeTargets = new Set(targets);
  const pairs: Array<{ visitId: string; appointmentId: string }> = [];
  const generic: SlideCandidateRow[] = [];
  for (const c of candidates) {
    if (c.linkedPhaseId) {
      // Fázishoz kötött foglalás → csak a saját fázisának alkalmára; ha az
      // nem vár időpontra, a foglalás marad, ahol van (nem csúszik máshova).
      if (c.linkedVisitId && freeTargets.has(c.linkedVisitId)) {
        pairs.push({ visitId: c.linkedVisitId, appointmentId: c.id });
        freeTargets.delete(c.linkedVisitId);
      }
      continue;
    }
    generic.push(c);
  }
  // A többi: a k-adik időpont a k-adik tervezett alkalomra (időrend ↔ terv-sorrend).
  const remainingTargets = targets.filter((t) => freeTargets.has(t));
  for (let k = 0; k < generic.length && k < remainingTargets.length; k++) {
    pairs.push({ visitId: remainingTargets[k], appointmentId: generic[k].id });
  }
  const leftovers = generic.slice(remainingTargets.length);

  const attach = async (visitId: string, appointmentId: string) => {
    await client.query(
      `UPDATE episode_visits SET appointment_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [appointmentId, visitId]
    );
    return syncVisitAppointment(client, episodeId, visitId, changedBy);
  };

  for (const p of pairs) {
    const sync = await attach(p.visitId, p.appointmentId);
    result.adopted.push({ visitId: p.visitId, appointmentId: p.appointmentId, primaryId: sync?.primaryId ?? null });
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: sync?.primaryId ?? null,
      episodeId,
      oldStatus: null,
      newStatus: null,
      changedBy,
      changeType: 'visit_change',
      reason: `A terv rácsúszott a foglalt időpontra (${p.appointmentId.slice(0, 8)})`,
    });
  }
  for (const c of leftovers) {
    // Az időpont a váz: tervezett alkalom híján az időpont maga lesz egy
    // (üres, foglalt) alkalom — a tartalom később pakolható bele.
    const visit = await createEpisodeVisit(client, { episodeId, daysOffset: DEFAULT_VISIT_GAP_DAYS });
    await attach(visit.id, c.id);
    result.spawned.push({ visitId: visit.id, appointmentId: c.id });
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: null,
      episodeId,
      oldStatus: null,
      newStatus: null,
      changedBy,
      changeType: 'visit_change',
      reason: `Új alkalom a foglalt időpontból — időpont tartalom nélkül (${c.id.slice(0, 8)})`,
    });
  }

  await normalizeVisitOrder(client, episodeId);
  return result;
}

/**
 * A rácsúszás saját tranzakcióban (olvasó route-ok / booking utáni hívók
 * számára). Olcsó előszűrés zár nélkül: ha nincs jelölt időpont, nem nyit
 * tranzakciót és nem ír semmit.
 */
export async function slidePlanOntoAppointmentsTx(
  pool: Pick<Pool, 'connect' | 'query'>,
  episodeId: string,
  changedBy: string
): Promise<PlanSlideResult | null> {
  if (!(await hasVisitAppointmentColumn(pool)) || !(await hasVisitDetachedColumn(pool))) return null;
  const pre = await pool.query(slideCandidateSql('probe'), [episodeId]);
  if (pre.rows.length === 0) return { adopted: [], spawned: [] };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await slidePlanOntoAppointments(client, episodeId, changedBy);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * A foglalt alkalmak időrendben „pinnelve": az aktuális sorrendben a foglalt
 * alkalmak által elfoglalt pozíciókat a foglalások időrendje tölti fel, a
 * tervezett (időpont nélküli) alkalmak a helyükön maradnak — így a terv
 * rácsúszik a vázra. Utána az EWP fázis-seq is a vizit-sorrendet követi.
 * Visszaadja, változott-e a sorrend.
 */
export async function normalizeVisitOrder(client: Queryable, episodeId: string): Promise<boolean> {
  if (!(await hasVisitAppointmentColumn(client))) return false;
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
  /** WP-6.5: kézzel leválasztva — a rácsúszás kihagyja, csak kézzel rendelhető vissza. */
  visitDetachedAt: string | null;
}

/**
 * A beteg jövőbeli, aktív foglalásai, amelyek egyetlen alkalomhoz sem
 * tartoznak (epizód nélküli portál-foglalás, vagy a kézzel leválasztott
 * időpont) — a vázhoz kézzel rendelhető szabad időpontok. Az epizód fázis
 * nélküli foglalásai a WP-6.5 óta olvasáskor maguktól rácsúsznak a tervre
 * (slidePlanOntoAppointments), így itt jellemzően a leválasztott és az
 * epizód nélküli időpontok maradnak.
 */
export async function listUnattachedAppointments(
  db: Queryable,
  episodeId: string
): Promise<UnattachedAppointmentRow[]> {
  if (!(await hasVisitAppointmentColumn(db))) return [];
  const hasDetached = await hasVisitDetachedColumn(db);
  const { rows } = await db.query(
    `SELECT a.id,
            COALESCE(a.start_time, ats.start_time) AS "startTime",
            COALESCE(a.end_time, ats.start_time + (COALESCE(ats.duration_minutes, 30) || ' minutes')::interval) AS "endTime",
            a.pool, a.step_code AS "stepCode", a.dentist_email AS "dentistEmail",
            a.appointment_status AS "appointmentStatus",
            ${hasDetached ? 'a.visit_detached_at' : 'NULL::timestamptz'} AS "visitDetachedAt"
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
      visitDetachedAt: toIso(row.visitDetachedAt),
    };
  });
}
