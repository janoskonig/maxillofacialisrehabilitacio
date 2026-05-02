/**
 * Kezelőorvos recompute service.
 *
 * A `patients.kezeleoorvos_user_id` (és a backward-compat `patients.kezeleoorvos`
 * VARCHAR mező) automatikus karbantartása. A logikát a megrendelő határozta
 * meg (lásd database/migrations/027_kezeleoorvos_user_id.sql fejléce):
 *
 *   B-eset (epizód): legutóbb nyitott AKTÍV `patient_episodes` sor
 *                    `assigned_provider_id`-je nyer.
 *   A-eset (időpont): ha B nincs, a `now()`-hoz időben legközelebbi nem
 *                    lemondott (`appointment_status` ≠ cancelled_*) és nem
 *                    elutasított (`approval_status` ≠ rejected) appointment
 *                    `dentist_email`-jéhez tartozó `users.id` nyer.
 *                    Az időablak: jövőbeli ∪ utolsó 30 nap.
 *   Egyik sem: NEM írjuk át a meglévő értéket (recompute „nem vonja vissza").
 *
 * Hívási helyek (write-side hookok):
 *   - app/api/appointments/route.ts             POST  (új időpont)
 *   - app/api/appointments/approve/route.ts     POST  (jóváhagyás)
 *   - app/api/patients/[id]/stages/new-episode/route.ts  POST  (új epizód)
 *   - app/api/episodes/[id]/route.ts            PUT   (provider változás)
 *   - lib/patient-episode-create.ts             (központi epizód-létrehozó)
 *
 * Az API válasz `changed: false`-ra állna, ha a számolt user_id megegyezik a
 * meglévő értékkel — az audit log helyett ez használható log szignálnak.
 *
 * A `recomputeKezeleoorvosSilent` wrapper kifejezetten write hookokba való:
 * sosem dob, csak a console-ra logol hibát, hogy egy recompute-hiba ne
 * blokkolja a fő művelet sikerét.
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from './db';
import { validateUUID } from './validation';

/** Duck-típus: bármilyen pg query-elhető objektum (Pool, PoolClient, mock). */
export interface DbQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface RecomputeKezeleoorvosResult {
  /** True, ha a `kezeleoorvos_user_id` (vagy a `kezeleoorvos` név) ténylegesen változott. */
  changed: boolean;
  /** A számolt user_id (B vagy A eset alapján). NULL, ha sem B, sem A nem szolgáltatott jelöltet. */
  userId: string | null;
  /** A számolt orvos neve (`users.doktor_neve` vagy fallback `users.email`). NULL, ha userId is NULL. */
  name: string | null;
  /** Honnan jött a jelölt: 'episode' (B), 'appointment' (A), vagy 'none' (nincs jelölt → no-op). */
  source: 'episode' | 'appointment' | 'none';
  /** Az előző `kezeleoorvos_user_id` érték (a write előtt). */
  previousUserId: string | null;
}

/**
 * Számolja és — ha változott — beírja a beteg új kezelőorvosát.
 *
 * @param patientId  A beteg UUID-ja.
 * @param db         Opcionális query-elhető (transzakcióhoz `PoolClient`-et adj át).
 *                   Ha nincs megadva, a globális poolt használjuk.
 */
export async function recomputeKezeleoorvos(
  patientId: string,
  db?: DbQueryable | Pool | PoolClient
): Promise<RecomputeKezeleoorvosResult> {
  const validatedPatientId = validateUUID(patientId, 'Beteg ID');
  const queryable: DbQueryable = (db as DbQueryable) ?? (getDbPool() as unknown as DbQueryable);

  // Aktuális érték (a változás-detektáláshoz).
  const currentRes = await queryable.query(
    `SELECT kezeleoorvos_user_id FROM patients WHERE id = $1`,
    [validatedPatientId]
  );
  if (currentRes.rows.length === 0) {
    // Nem létezik beteg — nincs mit csinálni. Hagyjuk silent no-opnak,
    // a hívó (write hook) nem kell, hogy elhasaljon ettől.
    return { changed: false, userId: null, name: null, source: 'none', previousUserId: null };
  }
  const previousUserId: string | null = currentRes.rows[0].kezeleoorvos_user_id ?? null;

  // B-eset: legutóbb nyitott aktív epizód provider-je.
  const episodeRes = await queryable.query(
    `SELECT u.id AS user_id, COALESCE(u.doktor_neve, u.email) AS name
       FROM patient_episodes pe
       JOIN users u ON u.id = pe.assigned_provider_id
      WHERE pe.patient_id = $1
        AND pe.status = 'active'
        AND pe.assigned_provider_id IS NOT NULL
      ORDER BY pe.opened_at DESC NULLS LAST, pe.created_at DESC NULLS LAST
      LIMIT 1`,
    [validatedPatientId]
  );

  let candidateUserId: string | null = null;
  let candidateName: string | null = null;
  let source: 'episode' | 'appointment' | 'none' = 'none';

  if (episodeRes.rows.length > 0) {
    candidateUserId = episodeRes.rows[0].user_id;
    candidateName = episodeRes.rows[0].name;
    source = 'episode';
  } else {
    // A-eset: now()-hoz időben legközelebbi nem-lemondott / nem-elutasított
    // appointment dentist_email-je. Ablak: jövő + utolsó 30 nap.
    // A `cancelled_by_doctor` / `cancelled_by_patient` (lib/active-appointment.ts
    // CANCELLED_APPOINTMENT_STATUSES) és `approval_status='rejected'`
    // (app/api/appointments/reject/route.ts) eseteket szűrjük ki — `no_show`
    // és `completed` viszont számít: a beteggel találkozott az orvos.
    const appointmentRes = await queryable.query(
      `SELECT u.id AS user_id, COALESCE(u.doktor_neve, u.email) AS name
         FROM appointments a
         JOIN users u ON u.email = a.dentist_email
        WHERE a.patient_id = $1
          AND a.start_time IS NOT NULL
          AND a.start_time >= now() - interval '30 days'
          AND (a.appointment_status IS NULL
               OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
          AND (a.approval_status IS NULL OR a.approval_status <> 'rejected')
        ORDER BY ABS(EXTRACT(EPOCH FROM (a.start_time - now()))) ASC,
                 a.start_time ASC
        LIMIT 1`,
      [validatedPatientId]
    );

    if (appointmentRes.rows.length > 0) {
      candidateUserId = appointmentRes.rows[0].user_id;
      candidateName = appointmentRes.rows[0].name;
      source = 'appointment';
    }
  }

  // Sem B, sem A → NEM írjuk át a meglévő értéket („ne vonja vissza").
  if (candidateUserId === null) {
    return {
      changed: false,
      userId: previousUserId,
      name: null,
      source: 'none',
      previousUserId,
    };
  }

  // Idempotens: csak akkor írunk, ha tényleg változik az user_id.
  // A név (kezeleoorvos VARCHAR) szinkronja egy külön sub-frissítés:
  // még akkor is felülírjuk, ha a user_id nem változott, mert lehet,
  // hogy a `users.doktor_neve` időközben változott — ezért külön nézzük.
  const needsUserIdUpdate = previousUserId !== candidateUserId;

  if (needsUserIdUpdate) {
    await queryable.query(
      `UPDATE patients
          SET kezeleoorvos_user_id = $1,
              kezeleoorvos = $2
        WHERE id = $3`,
      [candidateUserId, candidateName, validatedPatientId]
    );
  } else {
    // Csak a backward-compat név mező esetleges driftjét javítjuk csendben.
    await queryable.query(
      `UPDATE patients
          SET kezeleoorvos = $1
        WHERE id = $2 AND COALESCE(kezeleoorvos, '') <> COALESCE($1, '')`,
      [candidateName, validatedPatientId]
    );
  }

  return {
    changed: needsUserIdUpdate,
    userId: candidateUserId,
    name: candidateName,
    source,
    previousUserId,
  };
}

/**
 * Fire-and-forget wrapper write hookokhoz: sosem dob, hibát csak logol.
 * Így egy recompute-elhasalás nem teszi tönkre az appointment létrehozás
 * vagy episode update fő tranzakcióját.
 */
export async function recomputeKezeleoorvosSilent(
  patientId: string,
  db?: DbQueryable | Pool | PoolClient
): Promise<void> {
  try {
    await recomputeKezeleoorvos(patientId, db);
  } catch (error) {
    console.error(
      `[recomputeKezeleoorvos] Sikertelen recompute a beteghez (${patientId}):`,
      error
    );
  }
}
