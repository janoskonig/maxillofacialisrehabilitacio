/**
 * Közös INSERT az `episode_work_phase_audit` táblába (WP-0.3, kódaudit #12).
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
 * bejegyzés akkor is beíródik, csak a snapshot oszlopok maradnak NULL-on.
 */

export type WorkPhaseAuditQueryable = {
  query(text: string, params?: unknown[]): Promise<unknown>;
};

export interface WorkPhaseAuditEntry {
  episodeWorkPhaseId: string;
  episodeId: string;
  oldStatus: string;
  /** Pl. 'pending' | 'scheduled' | 'completed' | 'skipped' | 'deleted'. */
  newStatus: string;
  changedBy: string;
  reason?: string | null;
}

export async function insertWorkPhaseAudit(
  db: WorkPhaseAuditQueryable,
  entry: WorkPhaseAuditEntry
): Promise<void> {
  await db.query(
    `INSERT INTO episode_work_phase_audit
       (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason,
        work_phase_code, custom_label, pool, duration_minutes)
     SELECT $1::uuid, $2::uuid, $3, $4, $5, $6,
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
    ]
  );
}
