/**
 * Beutaló orvos (referrer) → felhasználói fiók feloldása.
 *
 * A `patient_referral.beutalo_orvos` szabad szöveges név. A statisztikai
 * rétegzéshez és a hiányzó-adat emlékeztetők megbízható célzásához ezt egy
 * valódi `users` sorra oldjuk fel, és a `patient_referral.beutalo_orvos_user_id`
 * FK-ba írjuk (additív — a szöveges mező megmarad).
 *
 * Egyértelműségi szabály: csak akkor kötjük FK-hoz, ha a normalizált név
 * PONTOSAN EGY aktív `beutalo_orvos` szerepű felhasználóra illeszkedik. Több vagy
 * nulla találat → NULL (nem tippelünk). A normalizálás szabálya a közös
 * `lib/normalize-person-name.ts` (trim + kisbetű + ékezet-strip) — korábban ez a
 * modul ékezet-érzékenyen hasonlított, a chat-oldali felismerés viszont nem.
 *
 * A `recomputeReferrerUserIdSilent` wrapper write hookokba való: sosem dob,
 * csak logol, hogy egy feloldási hiba ne blokkolja a beteg mentését.
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from './db';
import { normalizePersonName, resolveUniqueByName } from './normalize-person-name';

export interface DbQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/**
 * Orvosnév normalizálása az egyezés-vizsgálathoz.
 * A szabály forrása a `lib/normalize-person-name.ts`.
 */
export const normalizeDoctorName = normalizePersonName;

/**
 * Feloldja és — ha egyértelmű — beírja a beteg beutaló orvosának user_id-ját.
 * @returns A beállított user_id, vagy null (nincs egyértelmű találat).
 */
export async function recomputeReferrerUserId(
  patientId: string,
  db?: DbQueryable | Pool | PoolClient,
): Promise<string | null> {
  const q = (db ?? getDbPool()) as DbQueryable;

  const refRes = await q.query(
    `SELECT beutalo_orvos FROM patient_referral WHERE patient_id = $1`,
    [patientId],
  );
  if (refRes.rows.length === 0) return null;

  const rawName = refRes.rows[0].beutalo_orvos as string | null;

  let userId: string | null = null;
  if (normalizeDoctorName(rawName) !== '') {
    // A jelölteket teljes egészében lekérjük és JS-ben normalizálunk: normalizált
    // paramétert nyers oszlophoz hasonlítani nem lehet, egy SQL-oldali LIMIT 2
    // pedig a normalizálás előtt szűrne, tehát nem bizonyítana egyértelműséget.
    const matchRes = await q.query(
      `SELECT id, doktor_neve FROM users
        WHERE role = 'beutalo_orvos'
          AND active IS NOT FALSE
          AND doktor_neve IS NOT NULL`,
    );
    // Csak egyértelmű (pontosan egy) találatnál kötünk FK-t.
    const match = resolveUniqueByName(
      rawName,
      matchRes.rows as Array<{ id: string; doktor_neve: string | null }>,
      (r) => r.doktor_neve,
    );
    userId = match ? match.id : null;
  }

  await q.query(
    `UPDATE patient_referral SET beutalo_orvos_user_id = $2 WHERE patient_id = $1`,
    [patientId, userId],
  );
  return userId;
}

/** Fire-and-forget burkoló a beteg-mentési útvonalakhoz — sosem dob, csak logol. */
export function recomputeReferrerUserIdSilent(patientId: string): void {
  recomputeReferrerUserId(patientId).catch((err) => {
    console.error(`[recompute-referrer] hiba (${patientId}):`, err);
  });
}
