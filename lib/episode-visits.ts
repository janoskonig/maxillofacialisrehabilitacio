/**
 * WP-4.1a: vizit-hozzárendelés az episode_work_phases INSERT helyeihez.
 *
 * INVARIÁNS: minden új EWP sor vizitbe születik. Alapértelmezés = ÚJ egyfős
 * vizit az epizód vizit-listájának végére (seq = max+1, days_offset := a fázis
 * default_days_offset-je). Explicit visitId paraméter fogadása a WP-4.2 dolga.
 *
 * A helpereket a hívó tranzakcióján BELÜL kell hívni (client), hogy a vizit és
 * a fázis együtt szülessen vagy együtt bukjon.
 */

export type EpisodeVisitQueryable = {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

export interface CreateEpisodeVisitArgs {
  episodeId: string;
  /** Vizit-szintű forecast-eltolás: ennyi nappal az előző alkalom után. */
  daysOffset?: number | null;
  label?: string | null;
  plannedDurationMinutes?: number | null;
}

/** Új egyfős vizit az epizód vizit-listájának végére (seq = max+1). */
export async function createEpisodeVisit(
  db: EpisodeVisitQueryable,
  args: CreateEpisodeVisitArgs
): Promise<{ id: string; seq: number }> {
  const { rows } = await db.query(
    `INSERT INTO episode_visits (episode_id, seq, label, planned_duration_minutes, days_offset)
     SELECT $1, COALESCE(MAX(seq), -1) + 1, $2, $3, $4
     FROM episode_visits WHERE episode_id = $1
     RETURNING id, seq`,
    [
      args.episodeId,
      args.label ?? null,
      args.plannedDurationMinutes ?? null,
      args.daysOffset ?? null,
    ]
  );
  return { id: rows[0].id as string, seq: rows[0].seq as number };
}

/**
 * Több vizit egy menetben, a lista végére sorszámozva — a sablon-alkalmazás /
 * generate fázisonként külön vizitet hoz létre (a mai soronkénti modell
 * megfelelője). A visszaadott id-k sorrendje a bemenet sorrendje.
 */
export async function createEpisodeVisitsBatch(
  db: EpisodeVisitQueryable,
  episodeId: string,
  visits: Array<{ daysOffset?: number | null }>
): Promise<string[]> {
  if (visits.length === 0) return [];

  const baseRow = await db.query(
    `SELECT COALESCE(MAX(seq), -1) + 1 AS base_seq FROM episode_visits WHERE episode_id = $1`,
    [episodeId]
  );
  const baseSeq = Number(baseRow.rows[0].base_seq ?? 0);

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let pIdx = 1;
  for (let i = 0; i < visits.length; i++) {
    placeholders.push(`($${pIdx}, $${pIdx + 1}, $${pIdx + 2})`);
    values.push(episodeId, baseSeq + i, visits[i].daysOffset ?? null);
    pIdx += 3;
  }

  const { rows } = await db.query(
    `INSERT INTO episode_visits (episode_id, seq, days_offset)
     VALUES ${placeholders.join(', ')}
     RETURNING id, seq`,
    values
  );
  return [...rows]
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .map((r) => r.id as string);
}

/**
 * Régebbi környezetben (a lib backfill/sim scriptekből is fut) a tábla még
 * hiányozhat — a generate a hasToothCol/tombstone probe mintájára kérdezi le.
 */
export async function hasEpisodeVisitsTable(db: EpisodeVisitQueryable): Promise<boolean> {
  const probe = await db.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'episode_visits' LIMIT 1`
  );
  return probe.rows.length > 0;
}

export interface EpisodeVisitRow {
  id: string;
  seq: number;
  label: string | null;
  daysOffset: number | null;
  plannedDurationMinutes: number | null;
  /** 094: az alkalom időpontja (a váz) — NULL, ha még nincs foglalás. */
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentEnd: string | null;
  /** NULL = nyitott foglalás; 'completed' = megtörtént; egyéb státusz = nem aktív. */
  appointmentStatus: string | null;
}

/** Az epizód vizit-metaadatai seq-sorrendben — a GET work-phases válaszához (a UI erre épül). */
export async function listEpisodeVisits(
  db: EpisodeVisitQueryable,
  episodeId: string
): Promise<EpisodeVisitRow[]> {
  const probe = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'episode_visits' AND column_name = 'appointment_id' LIMIT 1`
  );
  const hasAppointment = probe.rows.length > 0;
  const apptCols = hasAppointment
    ? `, v.appointment_id AS "appointmentId",
         COALESCE(a.start_time, ats.start_time) AS "appointmentStart",
         COALESCE(a.end_time, ats.start_time + (COALESCE(ats.duration_minutes, 30) || ' minutes')::interval) AS "appointmentEnd",
         a.appointment_status AS "appointmentStatus"`
    : `, NULL::uuid AS "appointmentId", NULL::timestamptz AS "appointmentStart",
         NULL::timestamptz AS "appointmentEnd", NULL::text AS "appointmentStatus"`;
  const apptJoin = hasAppointment
    ? ` LEFT JOIN appointments a ON a.id = v.appointment_id
        LEFT JOIN available_time_slots ats ON ats.id = a.time_slot_id`
    : '';
  const { rows } = await db.query(
    `SELECT v.id, v.seq, v.label,
            v.days_offset as "daysOffset",
            v.planned_duration_minutes as "plannedDurationMinutes"${apptCols}
     FROM episode_visits v${apptJoin}
     WHERE v.episode_id = $1
     ORDER BY v.seq, v.created_at`,
    [episodeId]
  );
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : v != null ? String(v) : null);
    return {
      id: String(row.id),
      seq: Number(row.seq),
      label: row.label != null ? String(row.label) : null,
      daysOffset: row.daysOffset != null ? Number(row.daysOffset) : null,
      plannedDurationMinutes: row.plannedDurationMinutes != null ? Number(row.plannedDurationMinutes) : null,
      appointmentId: row.appointmentId != null ? String(row.appointmentId) : null,
      appointmentStart: toIso(row.appointmentStart),
      appointmentEnd: toIso(row.appointmentEnd),
      appointmentStatus: row.appointmentStatus != null ? String(row.appointmentStatus) : null,
    };
  });
}

/**
 * A megadott vizitek közül törli azokat, amelyekre már nem hivatkozik EWP sor
 * (merge után kiürült egyfős vizitek). Csak üres vizitet töröl.
 */
export async function deleteEpisodeVisitsIfEmpty(
  db: EpisodeVisitQueryable,
  visitIds: string[]
): Promise<number> {
  if (visitIds.length === 0) return 0;
  const result = await db.query(
    `DELETE FROM episode_visits v
     WHERE v.id = ANY($1)
       AND NOT EXISTS (SELECT 1 FROM episode_work_phases e WHERE e.visit_id = v.id)`,
    [visitIds]
  );
  return result.rowCount ?? 0;
}
