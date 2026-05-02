/**
 * Canonical active-appointment predicate.
 *
 * Az "aktív appointment" definíciója: olyan appointment sor, amely
 * foglalásként él (nem törölt), és emiatt elveszi a hozzá tartozó
 * kezelési lépés szabad slotját.
 *
 * Ezt a definíciót használja:
 *   - a worklist BOOKED/READY státusz döntés (nem foglalható, ha aktív
 *     appointment van a step_code-ra),
 *   - a slot_intent → appointment konverzió guardja (lib/convert-slot-intent.ts),
 *   - az appointment-service guard ugyanezt használja,
 *   - a one-hard-next ellenőrzés is ezzel közös definíciót oszt meg,
 *   - a diagnosztikai riport (Phase 2) is ezt használja.
 *
 * Ahol "aktív" = (status IS NULL) VAGY (status NOT IN cancelled/no_show).
 *
 * A `appointments` táblát `a` aliassal feltételezzük; szükség esetén a fragment
 * `String#replaceAll('a.', '<saját alias>.')`-szal átírható.
 */

/** Statuses that mark an appointment as cancelled (frees the work phase). */
export const CANCELLED_APPOINTMENT_STATUSES = ['cancelled_by_doctor', 'cancelled_by_patient'] as const;
/** Statuses that hide an appointment from "future visible" listings (cancelled + no_show). */
export const NON_VISIBLE_APPOINTMENT_STATUSES = ['cancelled_by_doctor', 'cancelled_by_patient', 'no_show'] as const;

/**
 * "Active" = a unique-index/booking-guard értelmében foglaltnak számít.
 *
 * Konkrétan: ez az appointment elveszi a (episode_id, step_code) helyét, és
 * második pending foglalás már nem hozható létre rá az
 * `idx_appointments_unique_pending_step` partial unique index miatt.
 *
 * Cancelled state-ek (cancelled_by_doctor, cancelled_by_patient) szabaddá teszik
 * a step-et. A `no_show` jelenleg AKTÍV-nak számít — ezt a viselkedést
 * megőrizzük; a status-sync szabályok későbbi fázisban változtathatnak ezen.
 */
export const SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT = `(
  a.appointment_status IS NULL
  OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient')
)`;

/**
 * "Visible future" = jövőbeli, megjelenítendő foglalás.
 *
 * Ez kicsit szigorúbb az aktívnál: ide a `no_show` is kihullik, mert a múltbeli
 * meg-nem-jelenést nem akarjuk "jövőbeli foglalás"-ként mutatni.
 */
export const SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT = `(
  a.appointment_status IS NULL
  OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient', 'no_show')
)`;

/**
 * Status-szintű szűrő `appointments` táblára (alias `a`),
 * az "aktív" fragment KOMPLEMENTERE: kifejezetten csak a cancelled rows.
 * Hasznos pl. dangling-appointment-id típusú riportokban.
 */
export const SQL_APPOINTMENT_CANCELLED_STATUS_FRAGMENT =
  `a.appointment_status IN ('cancelled_by_doctor', 'cancelled_by_patient')`;

/** TS-side mirror of {@link SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}. */
export function isAppointmentActive(status: string | null | undefined): boolean {
  if (status == null) return true;
  return !(CANCELLED_APPOINTMENT_STATUSES as readonly string[]).includes(status);
}

/** TS-side mirror of {@link SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT}. */
export function isAppointmentVisible(status: string | null | undefined): boolean {
  if (status == null) return true;
  return !(NON_VISIBLE_APPOINTMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * Canonical step identity for an appointment.
 *
 * Forward-compat: amikor `appointments.work_phase_id` migráció (025) lefutott
 * és backfilled, a guardok először `work_phase_id`-t fognak nézni, majd
 * visszaesnek a `(episode_id, step_code)` legacy kulcsra. A SQL fragment
 * dinamikusan figyelembe veszi, hogy létezik-e az oszlop, hogy a régi DB-ken
 * is működjön kódváltás nélkül.
 */
export interface AppointmentStepIdentitySql {
  /** JOIN fragment to attach the canonical episode_work_phases row (work_phase_id wins, fallback to step_code). */
  joinEpisodeWorkPhaseSql: (alias: string) => string;
  /** SELECT-clause expression for the canonical step code. */
  effectiveStepCodeExpr: (ewpAlias: string) => string;
}

export function buildStepIdentitySql(hasWorkPhaseIdColumn: boolean): AppointmentStepIdentitySql {
  if (hasWorkPhaseIdColumn) {
    return {
      joinEpisodeWorkPhaseSql: (alias) => `LEFT JOIN episode_work_phases ${alias}
        ON (a.work_phase_id IS NOT NULL AND ${alias}.id = a.work_phase_id)
        OR (a.work_phase_id IS NULL AND ${alias}.episode_id = a.episode_id AND ${alias}.work_phase_code = a.step_code)`,
      effectiveStepCodeExpr: (ewpAlias) => `COALESCE(${ewpAlias}.work_phase_code, a.step_code)`,
    };
  }
  return {
    joinEpisodeWorkPhaseSql: (alias) =>
      `LEFT JOIN episode_work_phases ${alias} ON ${alias}.episode_id = a.episode_id AND ${alias}.work_phase_code = a.step_code`,
    effectiveStepCodeExpr: (ewpAlias) => `COALESCE(${ewpAlias}.work_phase_code, a.step_code)`,
  };
}

/**
 * Cache: does `appointments.work_phase_id` exist?
 * Defaults to `null` (= "not probed yet"); legacy mode is used until probed.
 */
let appointmentsWorkPhaseIdColumnExists: boolean | null = null;

export function setAppointmentsWorkPhaseIdColumnExists(value: boolean): void {
  appointmentsWorkPhaseIdColumnExists = value;
}

export function resetAppointmentsWorkPhaseIdColumnCache(): void {
  appointmentsWorkPhaseIdColumnExists = null;
}

export function getAppointmentsWorkPhaseIdColumnExistsCached(): boolean | null {
  return appointmentsWorkPhaseIdColumnExists;
}

export interface InformationSchemaQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ exists?: boolean }> }>;
}

/** Probe `information_schema.columns` once and cache the result. */
export async function probeAppointmentsWorkPhaseIdColumn(
  db: InformationSchemaQueryable
): Promise<boolean> {
  if (appointmentsWorkPhaseIdColumnExists !== null) {
    return appointmentsWorkPhaseIdColumnExists;
  }
  try {
    const res = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'appointments'
           AND column_name = 'work_phase_id'
       ) AS exists`
    );
    appointmentsWorkPhaseIdColumnExists = res.rows[0]?.exists === true;
  } catch {
    appointmentsWorkPhaseIdColumnExists = false;
  }
  return appointmentsWorkPhaseIdColumnExists;
}
