/**
 * Canonical `appointments.appointment_status` taxonomy — single source of truth.
 *
 * Mirrors the SQL CHECK constraint added in
 * `database/legacy/migration_appointments_status.sql` and asserted by
 * `database/migrations/026_assert_appointment_status_check.sql`. The
 * `appointment_status_taxonomy` test verifies the two stay in sync.
 *
 * Background: see docs/APPOINTMENT_STATUS_TAXONOMY.md.
 *
 * USAGE RULE:
 *   - Anywhere code writes appointment_status, type the value as
 *     `AppointmentStatus | null` (NULL = pending) so the TypeScript compiler
 *     refuses unknown literals.
 *   - Anywhere code reads appointment_status from the wire (request bodies,
 *     CSV imports, etc.), pipe the value through `parseAppointmentStatus`
 *     before persisting.
 *   - Anywhere code BRANCHES on appointment_status, prefer the helper
 *     functions in `lib/active-appointment.ts` instead of comparing literals
 *     directly. Those helpers share the canonical list with the SQL fragments
 *     and the partial unique index.
 */

/**
 * The exact string set that `appointments.appointment_status` may take.
 * Schema: `VARCHAR(30) CHECK (appointment_status IN (...)) NULL`. NULL is the
 * 5th legal value (= pending appointment, see docs/APPOINTMENT_STATUS_TAXONOMY.md).
 */
export const APPOINTMENT_STATUS_VALUES = [
  'cancelled_by_doctor',
  'cancelled_by_patient',
  'completed',
  'no_show',
] as const;

/** A non-null appointment status value. */
export type AppointmentStatus = (typeof APPOINTMENT_STATUS_VALUES)[number];

/** A possibly-null appointment status, including the implicit "pending" / NULL. */
export type AppointmentStatusOrPending = AppointmentStatus | null;

/** Set lookup, ~O(1). */
const VALID_SET: ReadonlySet<string> = new Set(APPOINTMENT_STATUS_VALUES);

/** Type-guard: true if `value` is one of the canonical non-null statuses. */
export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === 'string' && VALID_SET.has(value);
}

/**
 * Parse a raw value coming from the wire (request body, CSV row, etc.) into
 * a canonical `AppointmentStatusOrPending`. Returns the parsed status, or
 * `{ error }` if the value is unrecognised. NULL / undefined / empty string
 * map to NULL (= pending).
 */
export function parseAppointmentStatus(
  value: unknown
): { ok: true; status: AppointmentStatusOrPending } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, status: null };
  }
  if (isAppointmentStatus(value)) {
    return { ok: true, status: value };
  }
  return {
    ok: false,
    error: `Invalid appointment_status value: ${JSON.stringify(value)}. Allowed: ${APPOINTMENT_STATUS_VALUES.join(', ')} or NULL.`,
  };
}

/**
 * Compile-time exhaustiveness helper. Use in switch-statements over
 * `AppointmentStatus` so adding a new value to the union forces every consumer
 * to update.
 *
 * @example
 *   switch (status) {
 *     case 'completed':           return ...;
 *     case 'no_show':             return ...;
 *     case 'cancelled_by_doctor': return ...;
 *     case 'cancelled_by_patient':return ...;
 *     default: return assertExhaustiveAppointmentStatus(status);
 *   }
 */
export function assertExhaustiveAppointmentStatus(value: never): never {
  throw new Error(`Unhandled appointment_status: ${String(value)}`);
}
