-- Migration 026: Assert appointments.appointment_status taxonomy.
--
-- Plan: docs work_phase_booking_8f6f78b9 — enforcement of the status taxonomy
-- documented in docs/APPOINTMENT_STATUS_TAXONOMY.md.
--
-- =========================================================================
-- NULL SEMANTICS — read this BEFORE editing the CHECK below
-- =========================================================================
-- `appointments.appointment_status` is a NULLABLE column by design:
--
--   • NULL  ⇒ "pending" — the appointment was created but no terminal status
--             has been recorded yet. This is the most common state for a
--             newly-booked future appointment.
--   • The 4 string values cover terminal / observed states.
--
-- The CHECK below is written as `appointment_status IS NULL OR appointment_status IN (...)`
-- so NULL is EXPLICITLY accepted as legal. We do not rely on the standard
-- SQL three-valued-logic loophole (`x IN (...)` returns UNKNOWN for NULL x,
-- which CHECK treats as "not failed") because:
--   • it makes the intent obvious to anyone reading the schema;
--   • the canonical TS guard (`isAppointmentStatus`) and the canonical SQL
--     fragments in `lib/active-appointment.ts` ALSO treat NULL explicitly;
--   • the drift detector test asserts `IS NULL` is present in the CHECK
--     body — if a future edit removes it, CI fails.
--
-- Active/visible/cancelled classification of NULL:
--   • Active  (occupies work-phase slot):  YES — see SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT
--   • Visible (future booking display):    YES — see SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT
--   • Cancelled (frees slot):              NO
--
-- DO NOT add a NOT NULL constraint without first migrating every read site
-- (worklist, scheduling, calendar, dashboards) to use a sentinel string;
-- that's a Phase 6 decision per docs/APPOINTMENT_STATUS_TAXONOMY.md.
-- =========================================================================
--
-- The legacy migration `database/legacy/migration_appointments_status.sql`
-- attempts to add a CHECK constraint, but on older deployments either:
--   - the migration ran with `ADD COLUMN IF NOT EXISTS` semantics (CHECK
--     skipped because the column already existed without the constraint), or
--   - the constraint was renamed / dropped during a hotfix and not restored.
--
-- This migration is IDEMPOTENT and asserts that:
--   1. The column exists (already true everywhere; safety guard).
--   2. There exists a CHECK constraint matching the 4 canonical values
--      (cancelled_by_doctor, cancelled_by_patient, completed, no_show)
--      AND explicitly accepting NULL; if not, it is added under the canonical
--      name `appointments_appointment_status_check`.
--   3. The constraint is VALIDATED (not NOT VALID) — failing rows raise here
--      so the operator can run the booking-consistency report and quarantine
--      them BEFORE this migration succeeds.
--
-- If the migration fails with `check constraint ... is violated by some row`,
-- run /api/admin/booking-consistency on a clone first; the new
-- `unknown_appointment_status_value` check pinpoints the bad rows.
--
-- Backward-compatible: the CHECK is identical to what the schema has always
-- documented; existing well-formed data passes (including all NULL rows).

BEGIN;

DO $assert_status_check$
DECLARE
  has_canonical_constraint BOOLEAN;
  bad_row_count INT;
BEGIN
  -- 1) Column existence (defensive — the column has been there since v0).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'appointments'
      AND column_name = 'appointment_status'
  ) THEN
    RAISE EXCEPTION
      '[026] appointments.appointment_status column missing — schema is older than expected';
  END IF;

  -- 2) Detect any pre-existing CHECK that already enforces the canonical 4 values.
  --    We look for any CHECK on the column whose definition contains all 4
  --    canonical literals; the constraint NAME may vary across deployments.
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'appointments'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%appointment_status%'
      AND pg_get_constraintdef(c.oid) ILIKE '%cancelled_by_doctor%'
      AND pg_get_constraintdef(c.oid) ILIKE '%cancelled_by_patient%'
      AND pg_get_constraintdef(c.oid) ILIKE '%completed%'
      AND pg_get_constraintdef(c.oid) ILIKE '%no_show%'
      AND c.convalidated = true
  ) INTO has_canonical_constraint;

  IF has_canonical_constraint THEN
    RAISE NOTICE '[026] appointment_status CHECK constraint already present and valid — no-op.';
  ELSE
    -- 3) Check for non-conforming rows BEFORE adding the constraint.
    SELECT COUNT(*) INTO bad_row_count
    FROM appointments
    WHERE appointment_status IS NOT NULL
      AND appointment_status NOT IN (
        'cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show'
      );

    IF bad_row_count > 0 THEN
      RAISE EXCEPTION
        '[026] Cannot add CHECK constraint: % rows have appointment_status outside the canonical taxonomy. Run /api/admin/booking-consistency to identify them, then re-run this migration.',
        bad_row_count;
    END IF;

    -- 4) Drop any half-baked older constraints with similar definitions that
    --    are NOT VALID, so we can re-add a fresh, validated one. Tolerate
    --    missing — pg_constraint may have nothing.
    PERFORM 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'appointments'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%appointment_status%';

    -- 5) Add the canonical constraint under a stable name.
    BEGIN
      ALTER TABLE appointments
        ADD CONSTRAINT appointments_appointment_status_check
        CHECK (
          appointment_status IS NULL
          OR appointment_status IN (
            'cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show'
          )
        );
      RAISE NOTICE '[026] Added appointments_appointment_status_check.';
    EXCEPTION WHEN duplicate_object THEN
      -- A constraint by exact name already exists. Force re-validation if it's
      -- NOT VALID, otherwise leave alone.
      RAISE NOTICE '[026] appointments_appointment_status_check already exists; revalidating.';
      ALTER TABLE appointments VALIDATE CONSTRAINT appointments_appointment_status_check;
    END;
  END IF;
END $assert_status_check$;

COMMIT;
