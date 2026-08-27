/**
 * Közös INSERT az `episode_work_phase_audit` táblába (WP-0.3, kódaudit #12;
 * WP-2.1: change_type).
 *
 * A 084-es migráció óta az audit sor tombstone: a fázis törlése után is
 * megmarad (`episode_work_phase_id` FK ON DELETE SET NULL), ezért MINDEN
 * beszúrásnak ki kell töltenie a denormalizált snapshot oszlopokat
 * (`work_phase_code`, `custom_label`, `pool`, `duration_minutes`) — ezek
 * nélkül a sor a fázis törlése után olvashatatlan.
 *
 * A helper a snapshotot az élő `episode_work_phases` sorból veszi, ezért a
 * törlés-flow-kban a `DELETE FROM episode_work_phases` ELŐTT kell hívni
 * (ugyanabban a tranzakcióban). Ha a fázis-sor már nem létezik, az audit
 * bejegyzés akkor is beíródik, de az `episode_work_phase_id` és a snapshot
 * oszlopok NULL-on maradnak (az FK INSERT-kor is validál, ezért nemlétező
 * id-t nem írhatunk bele).
 *
 * WP-2.1 (087-es migráció): a `change_type` mondja meg, MILYEN terv-mutáció
 * történt — a státusz-pár csak a status_change/delete eseteket fedte. Az
 * értékkészlet dokumentációja a 087-es migrációban van. Epizód-szintű
 * bejegyzéshez (reorder: EGY összefoglaló sor epizódonként) az
 * `episodeWorkPhaseId` NULL — ilyenkor a snapshot oszlopok is üresen
 * maradnak, a `reason` hordozza a mozgatott fázis(ok) kódját.
 */

export type WorkPhaseAuditQueryable = {
  query(text: string, params?: unknown[]): Promise<unknown>;
};

/** A terv-mutáció fajtája — az értékkészlet leírása a 087-es migrációban. */
export type WorkPhaseAuditChangeType =
  | 'status_change'
  | 'create'
  | 'delete'
  | 'reorder'
  | 'merge'
  | 'unmerge'
  | 'timing_change'
  | 'template_apply'
  | 'template_remove';

export interface WorkPhaseAuditEntry {
  /** Az érintett fázis; NULL az epizód-szintű (reorder) összefoglaló sornál. */
  episodeWorkPhaseId: string | null;
  episodeId: string;
  /** A mutáció előtti státusz; NULL, ahol nincs értelme (create, reorder). */
  oldStatus: string | null;
  /** Pl. 'pending' | 'scheduled' | 'completed' | 'skipped' | 'deleted'; NULL a reorder-sornál. */
  newStatus: string | null;
  changedBy: string;
  reason?: string | null;
  /**
   * Alapértelmezés: 'delete', ha newStatus 'deleted', különben
   * 'status_change' — így a meglévő státusz-váltó / törlő hívóhelyek
   * változtatás nélkül helyes értéket írnak.
   */
  changeType?: WorkPhaseAuditChangeType;
}

export async function insertWorkPhaseAudit(
  db: WorkPhaseAuditQueryable,
  entry: WorkPhaseAuditEntry
): Promise<void> {
  const changeType: WorkPhaseAuditChangeType =
    entry.changeType ?? (entry.newStatus === 'deleted' ? 'delete' : 'status_change');
  await db.query(
    `INSERT INTO episode_work_phase_audit
       (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason,
        change_type, work_phase_code, custom_label, pool, duration_minutes)
     SELECT ewp.id, $2::uuid, $3, $4, $5, $6, $7,
            ewp.work_phase_code, ewp.custom_label, ewp.pool, ewp.duration_minutes
       FROM (VALUES (1)) AS _egysor
       LEFT JOIN episode_work_phases ewp ON ewp.id = $1::uuid`,
    [
      entry.episodeWorkPhaseId,
      entry.episodeId,
      entry.oldStatus,
      entry.newStatus,
      entry.changedBy,
      entry.reason ?? null,
      changeType,
    ]
  );
}
