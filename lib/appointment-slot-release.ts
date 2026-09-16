/**
 * Lemondott (halott) foglalás-sor eltakarítása egy slotról, hogy a slot újra
 * foglalható legyen.
 *
 * Az `appointments.time_slot_id` UNIQUE (appointments_time_slot_id_key): egy
 * sloton egyszerre csak EGY appointment-sor lehet — a lemondott
 * (`cancelled_by_doctor` / `cancelled_by_patient`) sor is foglalja a helyet,
 * pedig a slot már `free`/`available`. A `createAppointment` és a
 * `convert-slot-intent` ezt INSERT … ON CONFLICT (time_slot_id) DO UPDATE
 * „revive"-val kezeli; a többi író útvonal (feltételes ajánlat, lemondás +
 * új ajánlat, áthelyezés meglévő slotra, alternatívára lépés) sima INSERT /
 * UPDATE-et futtat, ezért ott az írás ELŐTT ezt a helpert kell hívni, különben
 * a szabadnak látszó slot „Ezt az időpontot időközben más foglalta le"
 * (SLOT_ALREADY_BOOKED) hibával nem foglalható újra.
 *
 * Aktív sort SOHA nem bánt: azon a UNIQUE ütközés jogosan jön vissza.
 * A halott sor törlése ugyanaz az adatveszteség, amit a revive-út is vállal
 * (ott a sor felülíródik); a státusz-események CASCADE-del mennek, a
 * recall-feladat / alkalom link SET NULL. Egy esetleges (ritka) tervkötés-napló
 * hivatkozás (ON DELETE RESTRICT) érthető 409-cé alakul.
 */

import type { PoolClient } from 'pg';
import { HttpError } from './auth-server';
import { insertWorkPhaseAudit } from './work-phase-audit';

type Queryable = Pick<PoolClient, 'query'>;

export interface PurgeCancelledOptions {
  /** Ezt a sort ne érintse (pl. az éppen áthelyezett appointment). */
  exceptAppointmentId?: string | null;
  changedBy?: string;
}

export async function purgeCancelledAppointmentsOnSlot(
  client: Queryable,
  slotId: string,
  opts: PurgeCancelledOptions = {}
): Promise<string[]> {
  const params: unknown[] = [slotId];
  let exceptClause = '';
  if (opts.exceptAppointmentId) {
    params.push(opts.exceptAppointmentId);
    exceptClause = ` AND id <> $${params.length}`;
  }
  const dead = await client.query(
    `SELECT id, episode_id FROM appointments
      WHERE time_slot_id = $1
        AND appointment_status IN ('cancelled_by_doctor', 'cancelled_by_patient')${exceptClause}
      FOR UPDATE`,
    params
  );
  if (dead.rows.length === 0) return [];
  const ids: string[] = dead.rows.map((r: { id: string }) => r.id);

  // Védekező lépés: ha egy halott sor mégis fázis-linket tart (dangling), a
  // fázis nyíljon vissza — ne mutasson törölt sorra.
  const linked = await client.query(
    `SELECT id, episode_id, status FROM episode_work_phases WHERE appointment_id = ANY($1::uuid[]) FOR UPDATE`,
    [ids]
  );
  for (const ewp of linked.rows as Array<{ id: string; episode_id: string; status: string }>) {
    await client.query(
      `UPDATE episode_work_phases
          SET appointment_id = NULL,
              status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
        WHERE id = $1`,
      [ewp.id]
    );
    if (ewp.status === 'scheduled') {
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: ewp.id,
        episodeId: ewp.episode_id,
        oldStatus: 'scheduled',
        newStatus: 'pending',
        changedBy: opts.changedBy ?? 'system',
        reason: 'a slot újrafoglalásakor eltávolított lemondott foglalás linkje — fázis visszanyitva',
        changeType: 'integrity_repair',
      });
    }
  }

  try {
    await client.query(`DELETE FROM appointments WHERE id = ANY($1::uuid[])`, [ids]);
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg?.code === '23503') {
      throw new HttpError(
        409,
        'A slotot egy lemondott foglalás sora tartja, amelyre napló-bejegyzés hivatkozik, így nem távolítható el. Válasszon másik időpontot.',
        'CANCELLED_ROW_LOCKED'
      );
    }
    throw error;
  }
  return ids;
}
