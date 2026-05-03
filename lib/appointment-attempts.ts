/**
 * Appointment "attempt" számolás (migration 029).
 *
 * Egy munkafázis (`step_code`) több appointmenten keresztül zárulhat le, ha az
 * első próbák sikertelenek (rossz lenyomat, beteg nem tűrte stb.). Az
 * `appointments.attempt_number` oszlop minden új foglaláskor a "valós próbák"
 * számát tükrözi.
 *
 * "Valós próba" = a vizit megtörtént, vagy meg kellett volna történnie:
 *   • `'completed'`    — a próba sikerült
 *   • `'unsuccessful'` — a vizit megvolt, de a klinikai cél nem teljesült
 *   • `'no_show'`      — a beteg nem jött el (a slot elkelt)
 *
 * NEM számít próbának:
 *   • `NULL` — még nem történt meg (új pending foglalás, vagy a "rebook"
 *     útvonal által törlésre váró sor)
 *   • `'cancelled_by_doctor'` / `'cancelled_by_patient'` — a vizit nem
 *     történt meg, a slot felszabadult
 *
 * Ez biztosítja, hogy egy egyszerű "másik időpontot választok ugyanarra a
 * pending step-re" rebook NEM növeli a próbaszámlálót — csak a valós,
 * elvégzett próbák.
 */

/**
 * Minimal queryable interface — accepts both `pg.Pool` and `pg.PoolClient`
 * without pulling in the package-level overload type signatures (which use
 * generic stream / config overloads that don't unify cleanly with a simple
 * mock in tests). All call sites use only `query(sql, params)` with the
 * default-row-shape return.
 */
interface Querier {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export const ATTEMPT_COUNTING_STATUSES = ['completed', 'unsuccessful', 'no_show'] as const;

/**
 * Visszaadja a `(episode_id, step_code)` párhoz a következő `attempt_number`
 * értéket. Az 1 a default — soha nem ad vissza 0-t vagy negatív számot.
 *
 * Ha az `episodeId` vagy a `stepCode` hiányzik (pl. consult / kontroll
 * foglalás), 1-et ad vissza.
 *
 * @param db   Aktív tranzakciós klienssel hívd, hogy a számolás konzisztens
 *             legyen az ugyanabban a tranzakcióban végzett változtatásokkal.
 */
export async function nextAttemptNumber(
  db: Querier,
  episodeId: string | null | undefined,
  stepCode: string | null | undefined
): Promise<number> {
  if (!episodeId || !stepCode) return 1;

  const result = await db.query(
    `SELECT COUNT(*)::int AS prior_attempts
       FROM appointments
      WHERE episode_id = $1
        AND step_code = $2
        AND appointment_status IN ('completed', 'unsuccessful', 'no_show')`,
    [episodeId, stepCode]
  );

  const prior = Number(result.rows[0]?.prior_attempts ?? 0);
  return prior + 1;
}

/**
 * Cache: létezik-e az `appointments.attempt_number` oszlop?
 * `null` = még nem probáltuk; `false` = legacy DB (029 nincs alkalmazva);
 * `true` = új séma. A backend automatikusan kihagyja az oszlopot az INSERT-ből
 * legacy DB-n, hogy a build ne törjön a migráció előtt.
 */
let attemptColumnsExist: boolean | null = null;

export function setAttemptColumnsExist(value: boolean): void {
  attemptColumnsExist = value;
}

export function resetAttemptColumnsExistCache(): void {
  attemptColumnsExist = null;
}

interface InformationSchemaQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ exists?: boolean }> }>;
}

export async function probeAttemptColumns(db: InformationSchemaQueryable): Promise<boolean> {
  if (attemptColumnsExist !== null) return attemptColumnsExist;
  try {
    const res = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'appointments'
           AND column_name = 'attempt_number'
       ) AS exists`
    );
    attemptColumnsExist = res.rows[0]?.exists === true;
  } catch {
    attemptColumnsExist = false;
  }
  return attemptColumnsExist;
}
