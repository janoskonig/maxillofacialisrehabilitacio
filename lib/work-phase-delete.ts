/**
 * Munkafázis törlés előtti "felszabadítás".
 *
 * A kezelési terv szerkesztésekor bármelyik sor elhagyható — akkor is, ha már
 * van rá foglalt időpont, vagy már késznek lett jelölve. Ilyenkor a törlés
 * előtt rendezni kell a fázishoz kapcsolódó rekordokat, különben árván maradt
 * foglalás / nyitott slot intent / FK RESTRICT (23503 → generikus 500) marad
 * utána:
 *
 *   • aktív appointment  → lemondás (cancelled_by_doctor) + a slot felszabadítása
 *   • nyitott slot_intent → expired
 *   • episode_plan_items  → cancelled + archived_at + a legacy link bontása
 *   • migration_ewp_anomaly → törlés (csak migrációs diagnosztika)
 *
 * A hívó tranzakción belül, a `DELETE FROM episode_work_phases` ELŐTT hívja.
 */

import type { PoolClient } from 'pg';
import { SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT } from './active-appointment';

export interface WorkPhaseRefForDelete {
  id: string;
  /** episode_work_phases.work_phase_code — a legacy (work_phase_id nélküli) foglalások párosításához. */
  workPhaseCode: string | null;
}

export interface ReleaseWorkPhasesResult {
  /** Hány foglalt időpontot mondtunk le a törlés miatt. */
  cancelledAppointments: number;
  /** Hány nyitott slot intent-et zártunk le. */
  expiredIntents: number;
}

export interface ReleaseWorkPhasesOptions {
  /**
   * Puzzle v2 (094): az alkalom birtokolja a foglalást — a fázis törlésekor az
   * alkalom időpontja MARAD (üres, de foglalt alkalom). Az itt felsorolt
   * foglalásokat a lemondó scan kihagyja (a legacy step_code-egyezés se
   * kapja el őket).
   */
  keepAppointmentIds?: string[];
}

/**
 * Egy foglalás lemondása a felszabadítási szabályok szerint: status
 * cancelled_by_doctor, a slot szabad, a konvertált intent lejár, a
 * slot_intent link elengedve. A hívó tranzakcióján belül fut.
 */
export async function cancelAppointmentRelease(
  client: PoolClient,
  ap: { id: string; time_slot_id: string | null; slot_intent_id: string | null }
): Promise<void> {
  // WP-0.4 (kódaudit #03): a lemondott sor a slot_intent linket is elengedi,
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
  // A lemondott foglaláshoz tartozó konvertált intent lejáratása — ugyanaz,
  // mint a skip ágon (work-phases/[workPhaseId] route) és a lemondási
  // ágakon; e nélkül a 'converted' intent egy lemondott appointmentre
  // (mostantól: a semmire) mutatna tovább.
  if (ap.slot_intent_id) {
    await client.query(
      `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND state = 'converted'`,
      [ap.slot_intent_id]
    );
  }
}

/**
 * Felszabadítja a megadott munkafázisokat, hogy törölhetők legyenek.
 * Ugyanabban a tranzakcióban kell futnia, mint a tényleges DELETE.
 */
export async function releaseWorkPhasesForDelete(
  client: PoolClient,
  episodeId: string,
  phases: WorkPhaseRefForDelete[],
  options: ReleaseWorkPhasesOptions = {}
): Promise<ReleaseWorkPhasesResult> {
  if (phases.length === 0) return { cancelledAppointments: 0, expiredIntents: 0 };

  const phaseIds = phases.map((p) => p.id);
  const keepAppointmentIds = options.keepAppointmentIds ?? [];
  const stepCodes = Array.from(
    new Set(phases.map((p) => p.workPhaseCode).filter((c): c is string => !!c))
  );

  // 1) Nyitott slot intent-ek lezárása — SZÁNDÉKOSAN a foglalás-scan ELŐTT
  //    (WP-0.8, audit #13). Ha egy párhuzamos konverzió épp most alakítja az
  //    open intentet appointmentté, ez az UPDATE a konverzió intent-sorának
  //    zárján blokkolódik; mire lefut, a konvertált appointment már látszik a
  //    lenti scan-nek, így azt is lemondjuk. Fordított sorrendnél (scan előbb)
  //    a friss appointment kicsúszna a scan pillanatképéből, az intent pedig
  //    időközben 'converted' lévén az expiry-t is elkerülné — élő foglalás
  //    maradna egy törölt fázison. FOR UPDATE a scanben önmagában nem elég:
  //    a még nem commitolt sor a SELECT találati halmazában sincs benne.
  const intents = await client.query(
    `UPDATE slot_intents
        SET state = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE episode_id = $1
        AND state = 'open'
        AND (work_phase_id = ANY($2::uuid[]) OR (work_phase_id IS NULL AND step_code = ANY($3::text[])))
      RETURNING id`,
    [episodeId, phaseIds, stepCodes]
  );

  // 2) Aktív foglalások lemondása. Elsődlegesen a közvetlen work_phase_id
  //    kapcsolat alapján; a régebbi, link nélküli sorokat a (step_code +
  //    jövőbeli) párosítás fogja meg — ugyanaz a szemantika, mint a
  //    "Mégsem kész" ág appointment-lemondásánál.
  const appts = await client.query(
    `SELECT a.id, a.time_slot_id, a.slot_intent_id
       FROM appointments a
      WHERE a.episode_id = $1
        AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
        AND NOT (a.id = ANY($4::uuid[]))
        AND (
          a.work_phase_id = ANY($2::uuid[])
          OR (
            a.work_phase_id IS NULL
            AND a.step_code = ANY($3::text[])
            AND a.start_time > CURRENT_TIMESTAMP
          )
        )`,
    [episodeId, phaseIds, stepCodes, keepAppointmentIds]
  );

  for (const ap of appts.rows as Array<{
    id: string;
    time_slot_id: string | null;
    slot_intent_id: string | null;
  }>) {
    await cancelAppointmentRelease(client, ap);
  }

  // 3) Párhuzamos (episode_plan_items) modell: archiválás + a legacy FK bontása.
  //    A táblák a 021-es migrációval jöttek létre; ha egy környezetben mégsem
  //    léteznek, a törlés ne bukjon el rajtuk (a hiányzó tábla a tranzakciót
  //    is elvágná), ezért előbb megnézzük, léteznek-e.
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('episode_plan_items', 'migration_ewp_anomaly')`
  );
  const tableNames = new Set((tables.rows as Array<{ table_name: string }>).map((r) => r.table_name));

  if (tableNames.has('episode_plan_items')) {
    await client.query(
      `UPDATE episode_plan_items
          SET status = 'cancelled',
              archived_at = COALESCE(archived_at, now()),
              legacy_episode_work_phase_id = NULL,
              updated_at = now()
        WHERE legacy_episode_work_phase_id = ANY($1::uuid[])`,
      [phaseIds]
    );
  }

  if (tableNames.has('migration_ewp_anomaly')) {
    // Csak migrációs diagnosztika — a fázissal együtt megy.
    await client.query(`DELETE FROM migration_ewp_anomaly WHERE episode_work_phase_id = ANY($1::uuid[])`, [phaseIds]);
  }

  return {
    cancelledAppointments: appts.rows.length,
    expiredIntents: intents.rows.length,
  };
}

/**
 * Törlés-tombstone (WP-0.7, kódaudit #01): a törölt fázis kulcsának feljegyzése,
 * hogy a generate (sablon-őr + fog-szinkron) ne támassza fel a sort.
 *
 * A törlés maga valódi DELETE marad (konzisztensen a 078-as FK-feloldással és a
 * 084-es audit-tombstone-nal); ez a helper a `DELETE FROM episode_work_phases`
 * ELŐTT, ugyanabban a tranzakcióban hívandó, mert az élő sorból olvassa a
 * kulcsokat (work_phase_code, tooth_treatment_id, source_episode_pathway_id).
 *
 * Mellékhatás: a fog-fázishoz tartozó tooth_treatments sor státuszát
 * 'episode_linked' → 'pending'-re állítja, hogy a fog-szinkron (ami csak az
 * 'episode_linked' sorokat szedi fel) akkor se tegye vissza automatikusan, ha a
 * tombstone-tábla valamiért nem szűrne. A kezelési igény ettől még látszik a
 * Fogkezelés fülön, és kézzel újra hozzáadható a tervhez.
 *
 * A sablon-eltávolítás (handleRemovePathway) NEM hívja: ott az episode_pathways
 * sor is törlődik, és a tombstone FK ON DELETE CASCADE-je pont azért van, hogy
 * az újra alkalmazott sablon tiszta lappal generálódhasson.
 */
export async function insertWorkPhaseTombstones(
  client: PoolClient,
  episodeId: string,
  phaseIds: string[],
  deletedBy: string
): Promise<void> {
  if (phaseIds.length === 0) return;

  await client.query(
    `INSERT INTO episode_work_phase_tombstones
       (episode_id, work_phase_code, tooth_treatment_id, source_episode_pathway_id, deleted_by)
     SELECT ewp.episode_id, ewp.work_phase_code, ewp.tooth_treatment_id,
            ewp.source_episode_pathway_id, $3
       FROM episode_work_phases ewp
      WHERE ewp.episode_id = $1 AND ewp.id = ANY($2::uuid[])`,
    [episodeId, phaseIds, deletedBy]
  );

  await client.query(
    `UPDATE tooth_treatments tt
        SET status = 'pending'
       FROM episode_work_phases ewp
      WHERE ewp.episode_id = $1
        AND ewp.id = ANY($2::uuid[])
        AND ewp.tooth_treatment_id = tt.id
        AND tt.status = 'episode_linked'`,
    [episodeId, phaseIds]
  );
}
