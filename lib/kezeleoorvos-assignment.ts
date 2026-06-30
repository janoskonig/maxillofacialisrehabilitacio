/**
 * Kezelőorvos kézi hozzárendelés ("ragadós" elköteleződés).
 *
 * Egyetlen forrás: a beteg kezelőorvosa a `patients.kezeleoorvos_user_id`.
 * Ha kézzel állítják be (`kezeleoorvos_assigned_at` nem null), a recompute
 * (lib/recompute-kezeleoorvos.ts) NEM írja felül — így delegált beteg
 * számon kérhető. A backward-compat `kezeleoorvos` (név) és
 * `kezeleoorvos_intezete` mezőket mindig a `users` rekordból szinkronizáljuk,
 * hogy ne driftelhessenek el a szabad szövegtől.
 *
 * Hívási helyek:
 *   - app/api/patients/route.ts                POST  (új beteg, név→user feloldással)
 *   - app/api/patients/[id]/route.ts           PUT   (szerkesztés, név→user feloldással)
 *   - app/api/patients/[id]/kezeleoorvos/route.ts  PATCH (explicit delegálás user_id-vel)
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from './db';
import { validateUUID } from './validation';

export interface DbQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface AssignKezeleoorvosResult {
  /** True, ha a `kezeleoorvos_user_id` ténylegesen változott. */
  changed: boolean;
  /** Az új kezelőorvos user_id-ja (null, ha lekapcsoltuk). */
  userId: string | null;
  /** Az új kezelőorvos neve (`doktor_neve` vagy email). */
  name: string | null;
  /** Az új kezelőorvos intézménye (`users.intezmeny`). */
  intezmeny: string | null;
}

/** Aktív kezelőorvos-jelölt feloldása NÉV alapján (a form dropdown a nevet küldi). */
export async function resolveDoctorByName(
  name: string,
  db?: DbQueryable | Pool | PoolClient
): Promise<{ id: string; name: string; intezmeny: string | null } | null> {
  const trimmed = (name ?? '').trim();
  if (trimmed === '') return null;
  const queryable: DbQueryable = (db as DbQueryable) ?? (getDbPool() as unknown as DbQueryable);
  // A fogpótlástanász/admin orvosok közül a megjelenített név (doktor_neve,
  // fallback email) alapján. A form dropdown ugyanezt a listát használja
  // (/api/users/fogpotlastanasz), így a név itt egyezni fog.
  const res = await queryable.query(
    `SELECT id, COALESCE(doktor_neve, email) AS name, intezmeny
       FROM users
      WHERE active = true
        AND (role = 'fogpótlástanász' OR role = 'admin')
        AND COALESCE(doktor_neve, email) = $1
      ORDER BY (role = 'fogpótlástanász') DESC, created_at ASC
      LIMIT 1`,
    [trimmed]
  );
  if (res.rows.length === 0) return null;
  return { id: res.rows[0].id, name: res.rows[0].name, intezmeny: res.rows[0].intezmeny ?? null };
}

/**
 * Kézi kezelőorvos-hozzárendelés (vagy lekapcsolás). Ragadós: `assigned_at`-ot
 * is beállítja, így a recompute nem írja felül.
 *
 * @param patientId   A beteg UUID-ja.
 * @param userId      A kezelőorvos users.id-ja, vagy null a lekapcsoláshoz.
 * @param assignedBy  Ki rendelte hozzá (users.id), vagy null (rendszer/migrált).
 * @param db          Opcionális query-elhető (transzakcióhoz PoolClient).
 */
export async function assignKezeleoorvos(
  patientId: string,
  userId: string | null,
  assignedBy: string | null,
  db?: DbQueryable | Pool | PoolClient
): Promise<AssignKezeleoorvosResult> {
  const validatedPatientId = validateUUID(patientId, 'Beteg ID');
  const queryable: DbQueryable = (db as DbQueryable) ?? (getDbPool() as unknown as DbQueryable);

  const currentRes = await queryable.query(
    `SELECT kezeleoorvos_user_id FROM patients WHERE id = $1`,
    [validatedPatientId]
  );
  if (currentRes.rows.length === 0) {
    return { changed: false, userId: null, name: null, intezmeny: null };
  }
  const previousUserId: string | null = currentRes.rows[0].kezeleoorvos_user_id ?? null;

  // Lekapcsolás: töröljük a hozzárendelést → a recompute újra seedelhet.
  if (userId === null) {
    await queryable.query(
      `UPDATE patients
          SET kezeleoorvos_user_id = NULL,
              kezeleoorvos = NULL,
              kezeleoorvos_intezete = NULL,
              kezeleoorvos_assigned_at = NULL,
              kezeleoorvos_assigned_by = NULL
        WHERE id = $1
          AND set_config('app.skip_updated_at','on',true) IS NOT NULL`,
      [validatedPatientId]
    );
    return { changed: previousUserId !== null, userId: null, name: null, intezmeny: null };
  }

  const validatedUserId = validateUUID(userId, 'Kezelőorvos ID');
  const userRes = await queryable.query(
    `SELECT COALESCE(doktor_neve, email) AS name, intezmeny FROM users WHERE id = $1`,
    [validatedUserId]
  );
  if (userRes.rows.length === 0) {
    throw new Error(`Nem létező kezelőorvos user: ${validatedUserId}`);
  }
  const name: string = userRes.rows[0].name;
  const intezmeny: string | null = userRes.rows[0].intezmeny ?? null;
  const changed = previousUserId !== validatedUserId;

  if (changed) {
    // Új orvos → teljes (ragadós) hozzárendelés friss időbélyeggel.
    await queryable.query(
      `UPDATE patients
          SET kezeleoorvos_user_id = $1,
              kezeleoorvos = $2,
              kezeleoorvos_intezete = $3,
              kezeleoorvos_assigned_at = NOW(),
              kezeleoorvos_assigned_by = $4
        WHERE id = $5
          AND set_config('app.skip_updated_at','on',true) IS NOT NULL`,
      [validatedUserId, name, intezmeny, assignedBy, validatedPatientId]
    );
  } else {
    // Ugyanaz az orvos (pl. autosave): csak a név/intézmény esetleges driftjét
    // szinkronizáljuk a users rekordhoz. A delegálás időbélyegét (ki/mikor)
    // NEM bántjuk — különben minden mentés felülírná. Az assigned_at-ot
    // beállítjuk, ha valamiért még NULL (régi seedelt érték kézivé válik).
    await queryable.query(
      `UPDATE patients
          SET kezeleoorvos = $1,
              kezeleoorvos_intezete = $2,
              kezeleoorvos_assigned_at = COALESCE(kezeleoorvos_assigned_at, NOW()),
              kezeleoorvos_assigned_by = COALESCE(kezeleoorvos_assigned_by, $3)
        WHERE id = $4
          AND set_config('app.skip_updated_at','on',true) IS NOT NULL`,
      [name, intezmeny, assignedBy, validatedPatientId]
    );
  }

  return { changed, userId: validatedUserId, name, intezmeny };
}

/**
 * A beteg-űrlapból (POST/PUT) érkező szabad-szöveges kezelőorvos-NÉV feldolgozása.
 * Feloldja user_id-ra és kézi (ragadós) hozzárendelést rögzít. Ha a név üres,
 * lekapcsolja. Ha a név nem oldható fel ismert orvosra, NEM nyúl a sticky
 * hozzárendeléshez (a hívó nagy UPDATE-je által beírt szabad szöveg marad) —
 * ezt visszajelzi `resolved=false`-szal, hogy a hívó logolhasson.
 */
export async function applyKezeleoorvosFromForm(
  patientId: string,
  kezeleoorvosName: string | null | undefined,
  assignedBy: string | null,
  db?: DbQueryable | Pool | PoolClient
): Promise<{ resolved: boolean; result: AssignKezeleoorvosResult | null }> {
  const trimmed = (kezeleoorvosName ?? '').trim();
  if (trimmed === '') {
    const result = await assignKezeleoorvos(patientId, null, assignedBy, db);
    return { resolved: true, result };
  }
  const doctor = await resolveDoctorByName(trimmed, db);
  if (!doctor) {
    return { resolved: false, result: null };
  }
  const result = await assignKezeleoorvos(patientId, doctor.id, assignedBy, db);
  return { resolved: true, result };
}
