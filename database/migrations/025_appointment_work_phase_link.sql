-- Migration 025: Canonical work-phase ↔ appointment / slot-intent link.
--
-- Plan: docs work_phase_booking_8f6f78b9 — Phase 3.
--
-- Adds a nullable, backward-compatible `work_phase_id` column to both
-- `appointments` and `slot_intents`, with a partial unique index that
-- ONLY applies to rows that opted in (work_phase_id IS NOT NULL AND status
-- is "active"). This means:
--
--   • Existing rows are not modified — the column defaults to NULL and the
--     unique index ignores them.
--   • The legacy partial unique index `idx_appointments_unique_pending_step`
--     (episode_id, step_code, step_seq) keeps protecting unconverted rows.
--   • New write paths can opt-in by populating `work_phase_id`; the new
--     index then enforces "one active appointment per work phase".
--
-- The backfill script (scripts/migrate-025-backfill-work-phase-id.ts) is
-- separate and re-runnable. It only sets work_phase_id when the (episode_id,
-- step_code) → episode_work_phases mapping is unambiguous; ambiguous rows
-- land in `migration_ewp_anomaly` for human review.
--
-- Idempotent: safe to re-run.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) appointments.work_phase_id
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS work_phase_id UUID;
    COMMENT ON COLUMN appointments.work_phase_id IS
      'Canonical link to episode_work_phases.id. Nullable for backward compat (legacy rows still keyed via step_code/step_seq). Populated by 025 backfill and by new booking writes.';

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_appointments_work_phase'
    ) THEN
      ALTER TABLE appointments
        ADD CONSTRAINT fk_appointments_work_phase
        FOREIGN KEY (work_phase_id) REFERENCES episode_work_phases (id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_work_phase_id_nn
  ON appointments (work_phase_id)
  WHERE work_phase_id IS NOT NULL;

-- Partial unique index: at most one active appointment per work phase.
-- Active = NULL OR NOT IN ('cancelled_by_doctor', 'cancelled_by_patient').
-- "Completed" rows count as active here so a completed phase can't get a
-- second active appointment without first transitioning back to pending.
--
-- IMPORTANT: this index has the same predicate as
-- lib/active-appointment.ts/SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT — keep
-- both in sync to avoid the worklist offering bookings the index would reject.
DROP INDEX IF EXISTS idx_appointments_unique_work_phase_active;
CREATE UNIQUE INDEX idx_appointments_unique_work_phase_active
  ON appointments (work_phase_id)
  WHERE work_phase_id IS NOT NULL
    AND (
      appointment_status IS NULL
      OR appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient')
    );

-- -----------------------------------------------------------------------------
-- 2) slot_intents.work_phase_id
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'slot_intents'
  ) THEN
    ALTER TABLE slot_intents ADD COLUMN IF NOT EXISTS work_phase_id UUID;
    COMMENT ON COLUMN slot_intents.work_phase_id IS
      'Canonical link to episode_work_phases.id. Nullable for backward compat. New intents should be created with this set; legacy rows remain keyed via step_code.';

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_slot_intents_work_phase'
    ) THEN
      ALTER TABLE slot_intents
        ADD CONSTRAINT fk_slot_intents_work_phase
        FOREIGN KEY (work_phase_id) REFERENCES episode_work_phases (id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_slot_intents_work_phase_id_nn
  ON slot_intents (work_phase_id)
  WHERE work_phase_id IS NOT NULL;

-- Partial unique: at most one open slot intent per work phase.
-- Mirrors the slot intent open/converted/cancelled/expired state machine —
-- only `state = 'open'` participates.
DROP INDEX IF EXISTS idx_slot_intents_unique_open_work_phase;
CREATE UNIQUE INDEX idx_slot_intents_unique_open_work_phase
  ON slot_intents (work_phase_id)
  WHERE work_phase_id IS NOT NULL
    AND state = 'open';

COMMIT;
