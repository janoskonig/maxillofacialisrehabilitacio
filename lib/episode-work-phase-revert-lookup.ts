/**
 * Robust EWP-keresés appointment-revert (cancel / no_show / unsuccessful)
 * műveletekhez.
 *
 * Probléma: ha egy appointment-hez nincs `work_phase_id` (régi sor, vagy
 * a snapshot drift-elt), akkor `episode_id + work_phase_code` alapján kell
 * EWP-t találni. A korábbi implementációk ekkor `LIMIT 1`-et vagy
 * `rows.length === 1` őrt használtak. Ez két edge-case-t hibásan kezelt:
 *
 *   1. Több azonos `work_phase_code` az epizódban (pl. két `KONTROLL` sor
 *      a pathway-ban): a code-only lookup csendben kihagyta a revert-et,
 *      mert > 1 sor jött vissza.
 *   2. Egy meglévő (de nem hivatkozó) EWP volt sors-egyetlen — a revert
 *      „eltalálta" akkor is, ha az appointment_id nem mutatott rá.
 *
 * Megoldás: az `appointment_id` egyezés a legerősebb jel — ha van olyan
 * EWP, amely épp erre az appointment-re hivatkozik, azt használjuk
 * (függetlenül a `work_phase_code`-tól, mert a snapshot-drift pontosan
 * ezt a helyzetet hozza létre). Csak akkor esünk vissza a code-egyezésre,
 * ha az appointment_id-link sehol sem szerepel.
 */

import type { PoolClient } from 'pg';
import { getMergedFilterFragment } from './schema-probe';

export interface EwpForRevert {
  id: string;
  status: string;
  appointmentId: string | null;
}

export interface FindEwpForRevertOptions {
  episodeId: string;
  stepCode: string | null;
  workPhaseId: string | null;
  appointmentId: string;
}

/**
 * Megkeresi az appointment-revert által érintett `episode_work_phases` sort,
 * a tranzakció kontextusában FOR UPDATE-tel zárolva.
 *
 * Sorrend (preferencia szerint):
 *   1. `workPhaseId` adott — egyenes lookup (snapshot-tisztító flow-k).
 *   2. Bármely EWP az epizódban, aminek `appointment_id = $appointmentId`.
 *      Ez fedi a multi-step (`KONTROLL` × 2) eseteket is, mert a link
 *      determinisztikus.
 *   3. Code-only fallback: ha pontosan EGY EWP van az adott
 *      `(episode_id, work_phase_code)` párra, és a fenti egyik sem talált.
 *      Több találat esetén `null`-t adunk vissza — semmi vakon nem
 *      módosítunk.
 *
 * Az inline `information_schema` check megmaradt a code-only fallback
 * blokkjában, hogy a régebbi DB-ken (ahol a `merged_into_*` oszlop még
 * nincs) is működjön — ezt a `next-step-engine.ts` is így kezeli.
 */
export async function findEwpForAppointmentRevert(
  client: PoolClient,
  opts: FindEwpForRevertOptions
): Promise<EwpForRevert | null> {
  const { episodeId, stepCode, workPhaseId, appointmentId } = opts;

  if (workPhaseId) {
    const direct = await client.query(
      `SELECT id, status, appointment_id AS "appointmentId"
       FROM episode_work_phases
       WHERE id = $1
       FOR UPDATE`,
      [workPhaseId]
    );
    if (direct.rows.length === 1) {
      return {
        id: direct.rows[0].id,
        status: direct.rows[0].status,
        appointmentId: direct.rows[0].appointmentId ?? null,
      };
    }
  }

  // Determinisztikus visszakeresés a link mentén — multi-step esetén is
  // egyértelmű, mert az `appointment_id` unique az aktív foglalásokra.
  const linked = await client.query(
    `SELECT id, status, appointment_id AS "appointmentId"
     FROM episode_work_phases
     WHERE episode_id = $1 AND appointment_id = $2
     FOR UPDATE`,
    [episodeId, appointmentId]
  );
  if (linked.rows.length === 1) {
    return {
      id: linked.rows[0].id,
      status: linked.rows[0].status,
      appointmentId: linked.rows[0].appointmentId ?? null,
    };
  }

  if (!stepCode) return null;

  // Code-only fallback — csak akkor használjuk, ha a fenti két útvonal
  // egyikén sem találtunk semmit. Több találat esetén `null`-t adunk
  // vissza, mert nincs determinisztikus választás. A merged-szűrő SQL
  // fragmentet a modulszintű probe cache adja, így nem futtatunk
  // `information_schema` query-t minden hívásra.
  const mergedFilter = await getMergedFilterFragment(client, 'episode_work_phases');
  const byCode = await client.query(
    `SELECT id, status, appointment_id AS "appointmentId"
     FROM episode_work_phases
     WHERE episode_id = $1 AND work_phase_code = $2
       ${mergedFilter}
     FOR UPDATE`,
    [episodeId, stepCode]
  );
  if (byCode.rows.length === 1) {
    return {
      id: byCode.rows[0].id,
      status: byCode.rows[0].status,
      appointmentId: byCode.rows[0].appointmentId ?? null,
    };
  }

  return null;
}

/**
 * Vissza-revertel egy EWP-t `pending`-re, lenullázza az `appointment_id`
 * linket, és `episode_work_phase_audit`-be írja a változást.
 *
 * A hívó eldönti, hogy szeretné-e kiváltani (a `cancel/no_show` és
 * `mark_unsuccessful` flow-k különböző guard-okkal állapítják meg, hogy
 * jogosult-e a revert) — a helper csak az író-mellékhatást egyesíti.
 */
export async function revertWorkPhaseLinkToPending(
  client: PoolClient,
  params: {
    ewpId: string;
    episodeId: string;
    oldEwpStatus: string;
    changedBy: string;
    reasonText: string;
  }
): Promise<void> {
  const { ewpId, episodeId, oldEwpStatus, changedBy, reasonText } = params;
  await client.query(
    `UPDATE episode_work_phases
     SET status = 'pending', appointment_id = NULL
     WHERE id = $1`,
    [ewpId]
  );
  await client.query(
    `INSERT INTO episode_work_phase_audit
       (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ewpId, episodeId, oldEwpStatus, 'pending', changedBy, reasonText]
  );
}
