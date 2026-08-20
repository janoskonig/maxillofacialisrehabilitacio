/**
 * A beteg-űrlap optimista zárolásának (`If-Match`) közös eszközei.
 *
 * A zár tokenje a `patients.updated_at`. Két dolgot kell egyszerre teljesíteni:
 *
 * 1. **Az ellenőrzés és az írás egy tranzakcióban legyen.** Korábban a beteg-PUT a
 *    tranzakción KÍVÜL olvasott és hasonlított, az írás pedig csak később indult —
 *    a kettő között bárki írhatott (TOCTOU). A javítás nem sorzár, hanem
 *    compare-and-swap: a feltétel bekerül magába az `UPDATE ... WHERE` ágába, így
 *    az ellenőrzés és az írás atomi. Ennek mellékhaszna, hogy a kulcsot nem érintő
 *    UPDATE csak `FOR NO KEY UPDATE` zárat vesz, ami **nem ütközik** a
 *    `patients(id)`-re hivatkozó ~37 gyermektábla INSERT-jeinek `FOR KEY SHARE`
 *    zárával — egy explicit `SELECT ... FOR UPDATE` viszont mindet blokkolná.
 *
 * 2. **A token monoton legyen.** A `CURRENT_TIMESTAMP` a *tranzakció kezdete*, nem a
 *    commit ideje. Ha egy író sorban áll egy másik mögött, a tranzakciója KORÁBBAN
 *    indult, mint ahogy az első commitolt — így `CURRENT_TIMESTAMP`-pel régebbi
 *    tokent írna, mint amit az első már visszaadott a kliensnek. Ezért
 *    `clock_timestamp()` kell.
 *
 * A `clock_timestamp()` viszont csak akkor éli túl a beszúrást, ha a
 * `update_updated_at_column()` BEFORE UPDATE trigger nem írja felül — az ugyanis
 * feltétel nélkül `NEW.updated_at = CURRENT_TIMESTAMP`-ot ad, hacsak az
 * `app.skip_updated_at` GUC nincs bekapcsolva (database/migrations/062). A flag
 * tehát itt NEM a bump kikapcsolása, hanem épp az, ami a saját értékünket megvédi.
 * Mivel a `set_config(..., true)` tranzakció-lokális, a flaget használat után
 * vissza kell állítani — erre való a `restoreUpdatedAtTrigger`.
 *
 * (2026-08-15)
 */

import type { Pool, PoolClient } from 'pg';

export interface DbQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/**
 * SQL-töredék, ami a `patients` UPDATE `WHERE` ágába illesztve bekapcsolja a
 * trigger-kihagyást — a bevett repó-minta (lásd lib/kezeleoorvos-assignment.ts).
 * Azért a `WHERE`-ben, hogy garantáltan ugyanabban a statementben, a trigger
 * lefutása ELŐTT érvényesüljön.
 */
export const SKIP_UPDATED_AT_TRIGGER = `set_config('app.skip_updated_at','on',true) IS NOT NULL`;

/**
 * Visszakapcsolja az `updated_at` triggert a tranzakció hátralévő részére.
 * Kötelező meghívni minden olyan statement után, ami a `SKIP_UPDATED_AT_TRIGGER`-t
 * használta, ha a tranzakcióban további írás következik.
 */
export async function restoreUpdatedAtTrigger(db: DbQueryable | Pool | PoolClient): Promise<void> {
  await (db as DbQueryable).query(`SELECT set_config('app.skip_updated_at','off',true)`);
}

/** Tokenné alakít bármit, amit a DB vagy a kliens ad; érvénytelen érték → null. */
export function parseLockToken(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type LockTokenVerdict =
  /** A kliens tokenje egyezik a szerverével — az írás mehet. */
  | 'ok'
  /** A kliens elavult tokennel jött — 409. */
  | 'stale'
  /** Nincs mit összehasonlítani (hiányzó/olvashatatlan If-Match, vagy a szerveren nincs token). */
  | 'skipped';

export interface LockTokenComparison {
  verdict: LockTokenVerdict;
  client: Date | null;
  server: Date | null;
}

/**
 * Tiszta összehasonlító. Szándékosan `Date | string | null`-t vesz és nem sor-objektumot:
 * a beteg ugyanaz a mező két alakban érkezik a kódban — `SELECT *`-ból snake_case
 * `updated_at`, a `PATIENT_SELECT_FIELDS`-ből camelCase `updatedAt` —, és egy
 * sor-objektumot fogadó összehasonlító csendben `undefined`-ot hasonlítana.
 *
 * A mai viselkedést tartja: hiányzó vagy olvashatatlan `If-Match` átengedve
 * (backward compat), és ha a szerveren nincs `updated_at`, szintén nincs konfliktus.
 */
export function compareLockToken(
  ifMatch: string | null | undefined,
  serverUpdatedAt: Date | string | null | undefined
): LockTokenComparison {
  const client = ifMatch ? parseLockToken(ifMatch) : null;
  const server = parseLockToken(serverUpdatedAt);

  if (!ifMatch || !client || !server) {
    return { verdict: 'skipped', client, server };
  }
  return {
    verdict: client.getTime() === server.getTime() ? 'ok' : 'stale',
    client,
    server,
  };
}

/**
 * Átvegye-e a kliens a szervertől kapott új zár-tokent?
 *
 * Olyan végpontokhoz való, ahol NINCS `If-Match` (pl. a fog-kezelés lezárása), ezért
 * a friss token önmagában nem bizonyítja, hogy a kliens snapshotja aktuális volt.
 * Két feltétel együtt kell:
 *
 * 1. **Bizonyíték** — a művelet előtti szerver-token egyezzen azzal, amit a kliens
 *    tart. Enélkül egy elavult fül „megmosná" a saját tokenjét, és a következő
 *    mentése némán felülírna egy idegen írást, konfliktus-jelzés nélkül.
 * 2. **Monotonitás** — csak szigorúan újabb tokent fogadunk el. Egy régebbi érték
 *    (pl. késve érkező válasz) különben visszaléptetné a kliens tokenjét, és a
 *    következő mentés fölöslegesen 409-be futna.
 */
export function shouldAdoptLockToken(
  currentToken: Date | string | null | undefined,
  previousUpdatedAt: Date | string | null | undefined,
  nextUpdatedAt: Date | string | null | undefined
): boolean {
  const current = parseLockToken(currentToken);
  const previous = parseLockToken(previousUpdatedAt);
  const next = parseLockToken(nextUpdatedAt);

  if (!next || !current || !previous) return false;
  if (previous.getTime() !== current.getTime()) return false;
  return next.getTime() > current.getTime();
}

/**
 * Érvényteleníti a beteg zár-tokenjét — akkor kell, ha a szerver olyan adatot írt,
 * amit a beteg-űrlap BIRTOKOL (pl. a fogtérkép), tehát a nyitva hagyott űrlapoknak
 * 409-et kell kapniuk a néma felülírás helyett.
 *
 * A hívó tranzakciójában fut, saját tranzakciót nem nyit. A tokent kizárólag a
 * `RETURNING`-ből szabad olvasni (külön `SELECT` már egy másik tranzakció írását
 * láthatná).
 */
export async function bumpPatientLockToken(
  db: DbQueryable | Pool | PoolClient,
  patientId: string
): Promise<Date | null> {
  const q = db as DbQueryable;
  // Ezredmásodpercre igazítva: a `patients.updated_at` teljes (mikroszekundumos)
  // `timestamptz`, a token viszont körbejár egy JS `Date`-en, ami ms-re csonkol.
  // Igazítás nélkül a tárolt érték soha nem egyezne a visszaküldött If-Match-csel.
  // A `GREATEST` ág garantálja a szigorú növekedést akkor is, ha két írás ugyanabba
  // az ezredmásodpercbe esik — erre épül a kliensoldali monotonitás-ellenőrzés.
  const res = await q.query(
    `UPDATE patients
        SET updated_at = GREATEST(
              date_trunc('milliseconds', clock_timestamp()),
              date_trunc('milliseconds', updated_at) + interval '1 millisecond'
            )
      WHERE id = $1
        AND ${SKIP_UPDATED_AT_TRIGGER}
      RETURNING updated_at`,
    [patientId]
  );
  await restoreUpdatedAtTrigger(q);
  return res.rows.length > 0 ? parseLockToken(res.rows[0].updated_at) : null;
}

/**
 * A beteg sorának zárolása a leggyengébb módon, ami még sorrendet állít:
 * `FOR KEY SHARE` — pontosan az a zár, amit a `patients(id)`-re hivatkozó
 * gyermektáblák INSERT-jeinek FK-ellenőrzése is felvesz.
 *
 * Azért ez kell, és nem `FOR UPDATE`: így a hívó nem blokkol semmilyen párhuzamos
 * gyermek-INSERT-et (üzenet, időpont, dokumentum), csak a beteg sorát ténylegesen
 * átíró tranzakciókkal sorosít. Zár-sorrend kánon: ahol egy tranzakció a beteget és
 * az epizódot is érinti, a `patients` zárat kell ELŐSZÖR felvenni.
 *
 * @returns false, ha a beteg nem létezik.
 */
export async function lockPatientKeyShare(
  client: DbQueryable | PoolClient,
  patientId: string
): Promise<boolean> {
  const res = await (client as DbQueryable).query(
    `SELECT 1 FROM patients WHERE id = $1 FOR KEY SHARE`,
    [patientId]
  );
  return res.rows.length > 0;
}

/**
 * A beteg sorának zárolása írási szándékkal, de a kulcsot nem érintve
 * (`FOR NO KEY UPDATE`). Ütközik a másik írási szándékkal, de **nem** a
 * gyermek-INSERT-ek `FOR KEY SHARE` zárával.
 *
 * @returns a sor jelenlegi `updated_at`-je, vagy null, ha a beteg nem létezik.
 */
export async function lockPatientForWrite(
  client: DbQueryable | PoolClient,
  patientId: string
): Promise<{ updatedAt: Date | null } | null> {
  const res = await (client as DbQueryable).query(
    `SELECT updated_at FROM patients WHERE id = $1 FOR NO KEY UPDATE`,
    [patientId]
  );
  if (res.rows.length === 0) return null;
  return { updatedAt: parseLockToken(res.rows[0].updated_at) };
}
