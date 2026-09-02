/**
 * Felelős orvos az epizódon (patient_episodes.assigned_provider_id).
 *
 * A felelős orvos az epizód tulajdonsága, és az epizód folyamán bármikor
 * váltható: a váltás előre hat (új foglalások az új orvos naptárába, a nyitott
 * intentek lejárnak), a korábbi időpontok érintetlenek. Minden váltás a
 * provider_assignment_events táblába kerül (régi → új, indok, ki, mikor) —
 * ez a „ki volt a felelős mikor" története.
 */

export type ProviderQueryable = {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

export interface RecordProviderAssignmentArgs {
  episodeId: string;
  oldUserId: string | null;
  /** NULL = felelős orvos lekapcsolása (092 óta rögzíthető). */
  newUserId: string | null;
  reason?: string | null;
  createdBy: string;
}

/** Egy váltás naplózása — a hívó tranzakcióján BELÜL (client). */
export async function recordProviderAssignment(
  db: ProviderQueryable,
  args: RecordProviderAssignmentArgs
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO provider_assignment_events (episode_id, old_user_id, new_user_id, reason, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      args.episodeId,
      args.oldUserId,
      args.newUserId,
      args.reason?.trim() ? args.reason.trim().slice(0, 500) : null,
      args.createdBy,
    ]
  );
  return String(rows[0].id);
}

export interface ProviderAssignmentEvent {
  id: string;
  oldUserId: string | null;
  oldName: string | null;
  newUserId: string | null;
  newName: string | null;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** Az epizód felelős-orvos váltásai, legfrissebb elöl. */
export async function listProviderAssignmentEvents(
  db: ProviderQueryable,
  episodeId: string,
  limit = 50
): Promise<ProviderAssignmentEvent[]> {
  const { rows } = await db.query(
    `SELECT e.id,
            e.old_user_id AS "oldUserId",
            COALESCE(NULLIF(TRIM(ou.doktor_neve), ''), ou.email) AS "oldName",
            e.new_user_id AS "newUserId",
            COALESCE(NULLIF(TRIM(nu.doktor_neve), ''), nu.email) AS "newName",
            e.reason,
            e.created_at AS "createdAt",
            e.created_by AS "createdBy"
     FROM provider_assignment_events e
     LEFT JOIN users ou ON ou.id = e.old_user_id
     LEFT JOIN users nu ON nu.id = e.new_user_id
     WHERE e.episode_id = $1
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $2`,
    [episodeId, limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    oldUserId: r.oldUserId != null ? String(r.oldUserId) : null,
    oldName: r.oldName != null ? String(r.oldName) : null,
    newUserId: r.newUserId != null ? String(r.newUserId) : null,
    newName: r.newName != null ? String(r.newName) : null,
    reason: r.reason != null ? String(r.reason) : null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    createdBy: r.createdBy != null ? String(r.createdBy) : null,
  }));
}
