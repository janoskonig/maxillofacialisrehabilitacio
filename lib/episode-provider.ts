/**
 * Felelős orvos az epizódon (patient_episodes.assigned_provider_id).
 *
 * A felelős orvos az epizód tulajdonsága, és az epizód folyamán bármikor
 * váltható: a váltás előre hat (új foglalások az új orvos naptárába, a nyitott
 * intentek lejárnak), a korábbi időpontok érintetlenek. Minden váltás a
 * provider_assignment_events táblába kerül (régi → új, indok, ki, mikor) —
 * ez a „ki volt a felelős mikor" története.
 */

import { logger } from './logger';

export type ProviderQueryable = {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/**
 * Postgres hibakódok, amelyeknél a napló-sor kihagyható, mert a tábla vagy a
 * partíciója hiányzik: 42P01 undefined_table, 42703 undefined_column, 23514
 * check_violation (partícionált táblánál „no partition of relation … found for
 * row"). A legacy event-partitioning migráció nem tracked, így ahol sosem
 * futott le, a 093-ig a tábla hiányzik — ez ne blokkolja a klinikai műveletet
 * (a felelős orvos váltását), csak hangosan naplózódjon.
 */
const SCHEMA_UNAVAILABLE_CODES = new Set(['42P01', '42703', '23514']);

const SAVEPOINT_NAME = 'sp_provider_assignment';

function pgErrorCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export interface RecordProviderAssignmentArgs {
  episodeId: string;
  oldUserId: string | null;
  /** NULL = felelős orvos lekapcsolása (092 óta rögzíthető). */
  newUserId: string | null;
  reason?: string | null;
  createdBy: string;
}

/**
 * Egy váltás naplózása — a hívó tranzakcióján BELÜL (client, BEGIN után).
 *
 * SAVEPOINT-on belül fut: ha a napló-tábla vagy a partíciója hiányzik
 * (SCHEMA_UNAVAILABLE_CODES), a sor kimarad (null), a hívó tranzakciója — a
 * felelős orvos UPDATE-je — él tovább, a hiba a logban hangos. Minden más hiba
 * (pl. FK-sértés) tovább dobódik → a hívó ROLLBACK-el: a történet nem maradhat
 * le a tényleges átállításról, ha egyszer van hová írni.
 */
export async function recordProviderAssignment(
  db: ProviderQueryable,
  args: RecordProviderAssignmentArgs
): Promise<string | null> {
  await db.query(`SAVEPOINT ${SAVEPOINT_NAME}`);
  try {
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
    await db.query(`RELEASE SAVEPOINT ${SAVEPOINT_NAME}`);
    return String(rows[0].id);
  } catch (e) {
    try {
      await db.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT_NAME}`);
    } catch {
      // a kapcsolat/tranzakció már menthetetlen — a hívó ROLLBACK-je zárja le
    }
    const code = pgErrorCode(e);
    if (code && SCHEMA_UNAVAILABLE_CODES.has(code)) {
      logger.error(
        '[provider_assignment_events] a felelős orvos váltás-napló sora kimaradt: hiányzó tábla/partíció — futtasd: npm run migrate (093)',
        { code, episodeId: args.episodeId, message: e instanceof Error ? e.message : String(e) }
      );
      return null;
    }
    throw e;
  }
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

/**
 * Az epizód felelős-orvos váltásai, legfrissebb elöl. Hiányzó napló-tábla
 * (42P01, a 093 előtti DB) esetén üres lista — a popover történet-szekciója
 * ettől nem hibázik, a hiba a logban hangos.
 */
export async function listProviderAssignmentEvents(
  db: ProviderQueryable,
  episodeId: string,
  limit = 50
): Promise<ProviderAssignmentEvent[]> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = (await queryProviderAssignmentEvents(db, episodeId, limit)).rows;
  } catch (e) {
    if (pgErrorCode(e) === '42P01') {
      logger.error(
        '[provider_assignment_events] a váltás-történet nem olvasható: hiányzó tábla — futtasd: npm run migrate (093)',
        { episodeId }
      );
      return [];
    }
    throw e;
  }
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

function queryProviderAssignmentEvents(db: ProviderQueryable, episodeId: string, limit: number) {
  return db.query(
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
}
