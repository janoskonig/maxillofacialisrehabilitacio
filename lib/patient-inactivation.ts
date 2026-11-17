/**
 * Beteg inaktiválása / újraaktiválása (117-es migráció).
 *
 * Inaktív beteg = olyan beteg, aki nem tartozik (már) a rendelés
 * célközönségébe — pl. egyszerű fogpótlástani beteg, máshová irányították,
 * visszalépett. A rekord és minden kapcsolt adat megmarad, de a beteg:
 *   • alapból nem látszik a beteglistán (külön „Inaktív" nézet mutatja),
 *   • kimarad a munkalistákból, a dashboard- és stádium-nézetekből,
 *   • nem kap automatikus emlékeztetőt / nudge-ot,
 *   • nem kerül a kutatási exportba.
 * A karton közvetlen linkkel megnyitható, és bármikor újraaktiválható.
 *
 * Elhunyt betegeket NEM ez jelöli, hanem a `halal_datum`.
 *
 * Az SQL-fragmentek oszlop-toleránsak (`to_jsonb(alias) ->> ...`), így a
 * lekérdezések a 117-es migráció előtti sémán is lefutnak (minden beteg aktív).
 */

import type { Pool, PoolClient } from 'pg';
import { HttpError } from './auth-server';
import { SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT } from './active-appointment';
import {
  inactivationNoteRequired,
  isPatientInactivationReason,
  type PatientInactivationReason,
  type PatientInactivationState,
} from './patient-inactivation-reasons';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export {
  PATIENT_INACTIVATION_REASONS,
  PATIENT_INACTIVATION_REASON_LABELS,
  isPatientInactivationReason,
  inactivationNoteRequired,
} from './patient-inactivation-reasons';
export type { PatientInactivationReason, PatientInactivationState } from './patient-inactivation-reasons';

export { activePatientSql, inactivePatientSql, inactivationSelectSql } from './patient-inactivation-sql';

export async function getPatientInactivationState(
  db: Queryable,
  patientId: string,
): Promise<PatientInactivationState> {
  const result = await db.query(
    `SELECT
       p.id,
       (to_jsonb(p) ->> 'inaktivalva_at')::timestamptz AS inaktivalva_at,
       to_jsonb(p) ->> 'inaktivalas_oka' AS inaktivalas_oka,
       to_jsonb(p) ->> 'inaktivalas_megjegyzes' AS inaktivalas_megjegyzes,
       COALESCE(u.doktor_neve, u.email) AS inaktivalta_nev,
       (
         SELECT COUNT(*)::int
           FROM appointments a
           JOIN available_time_slots ats ON ats.id = a.time_slot_id
          WHERE a.patient_id = p.id
            AND ats.start_time > now()
            AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
       ) AS future_appointment_count
     FROM patients p
     LEFT JOIN users u ON u.id::text = to_jsonb(p) ->> 'inaktivalta_user_id'
     WHERE p.id = $1`,
    [patientId],
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, 'Beteg nem található', 'PATIENT_NOT_FOUND');
  }
  const row = result.rows[0];
  return {
    patientId: row.id,
    inaktivalvaAt: row.inaktivalva_at ? new Date(row.inaktivalva_at).toISOString() : null,
    inaktivalasOka: isPatientInactivationReason(row.inaktivalas_oka) ? row.inaktivalas_oka : null,
    inaktivalasMegjegyzes: row.inaktivalas_megjegyzes ?? null,
    inaktivaltaNev: row.inaktivalta_nev ?? null,
    futureAppointmentCount: Number(row.future_appointment_count ?? 0),
  };
}

export interface InactivatePatientInput {
  reason: unknown;
  note?: unknown;
}

/** A kérés-test validálása; HttpError(400) hibás inputra. */
export function parseInactivationInput(input: InactivatePatientInput): {
  reason: PatientInactivationReason;
  note: string | null;
} {
  if (!isPatientInactivationReason(input.reason)) {
    throw new HttpError(400, 'Érvénytelen inaktiválási ok', 'INVALID_INACTIVATION_REASON');
  }
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > 2000) {
    throw new HttpError(400, 'A megjegyzés legfeljebb 2000 karakter lehet', 'INACTIVATION_NOTE_TOO_LONG');
  }
  if (inactivationNoteRequired(input.reason) && note.length === 0) {
    throw new HttpError(400, 'Egyéb ok esetén a megjegyzés kötelező', 'INACTIVATION_NOTE_REQUIRED');
  }
  return { reason: input.reason, note: note.length > 0 ? note : null };
}

export async function inactivatePatient(
  db: Queryable,
  patientId: string,
  userId: string,
  input: InactivatePatientInput,
): Promise<void> {
  const { reason, note } = parseInactivationInput(input);
  const result = await db.query(
    `UPDATE patients
        SET inaktivalva_at = COALESCE(inaktivalva_at, now()),
            inaktivalas_oka = $2,
            inaktivalas_megjegyzes = $3,
            inaktivalta_user_id = COALESCE(CASE WHEN inaktivalva_at IS NULL THEN $4::uuid END, inaktivalta_user_id)
      WHERE id = $1
      RETURNING id`,
    [patientId, reason, note, userId],
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, 'Beteg nem található', 'PATIENT_NOT_FOUND');
  }
  await cancelAutomaticPatientTasks(db, patientId);
}

/**
 * Inaktiváláskor a rendszer által generált, a beteghez kötött nyitott
 * emlékeztető-feladatok (hiányzó adat, recall, OHIP-14) okafogyottá válnak:
 * 'cancelled'-re állítjuk őket. A kézi / delegált feladatok érintetlenek.
 */
export const AUTO_PATIENT_TASK_TYPES = ['missing_data', 'recall_due', 'ohip14'] as const;

export async function cancelAutomaticPatientTasks(db: Queryable, patientId: string): Promise<number> {
  const res = await db.query(
    `UPDATE user_tasks
        SET status = 'cancelled'
      WHERE patient_id = $1
        AND status = 'open'
        AND task_type = ANY($2::text[])`,
    [patientId, [...AUTO_PATIENT_TASK_TYPES]],
  );
  return res.rowCount ?? 0;
}

export async function reactivatePatient(db: Queryable, patientId: string): Promise<void> {
  const result = await db.query(
    `UPDATE patients
        SET inaktivalva_at = NULL,
            inaktivalas_oka = NULL,
            inaktivalas_megjegyzes = NULL,
            inaktivalta_user_id = NULL
      WHERE id = $1
      RETURNING id`,
    [patientId],
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, 'Beteg nem található', 'PATIENT_NOT_FOUND');
  }
}
