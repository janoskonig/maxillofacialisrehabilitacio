-- Migration 021: Episode plan migration — Phase 1 additive schema only.
-- episode_plan_items, events, migration_runs, migration_ewp_anomaly,
-- appointments.plan_item_id (+ optional link audit columns), indexes.
-- No application authority on this model until flags are enabled per runbook.
--
-- Runner: one file = one pool.query (scripts/run-all-migrations.js).
-- Transactional DDL only (no CREATE INDEX CONCURRENTLY).

BEGIN;

-- -----------------------------------------------------------------------------
-- migration_runs (referenced by plan items, anomalies, quarantine)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase TEXT NOT NULL,
  cutoff_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE migration_runs IS 'Episode plan migration batches; audit-only driver for backfill/quarantine jobs.';

-- -----------------------------------------------------------------------------
-- episode_plan_items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episode_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES patient_episodes (id) ON DELETE CASCADE,
  legacy_episode_work_phase_id UUID UNIQUE,
  work_phase_code TEXT,
  treatment_type_id UUID,
  location TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned', 'scheduled', 'completed', 'cancelled')),
  planned_date DATE,
  due_window_start TIMESTAMPTZ,
  due_window_end TIMESTAMPTZ,
  depends_on_item_id UUID REFERENCES episode_plan_items (id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  migration_run_id UUID REFERENCES migration_runs (id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE episode_plan_items IS 'Primary episode plan model; patient_id derived via episode_id → patient_episodes.';
COMMENT ON COLUMN episode_plan_items.legacy_episode_work_phase_id IS 'Set only for rows materialized from episode_work_phases; never reuse ewp.id as pi.id.';

CREATE INDEX IF NOT EXISTS idx_episode_plan_items_episode_id
  ON episode_plan_items (episode_id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_episode_plan_items_episode_status
  ON episode_plan_items (episode_id, status) WHERE archived_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'treatment_types'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_episode_plan_items_treatment_type'
  ) THEN
    ALTER TABLE episode_plan_items
      ADD CONSTRAINT fk_episode_plan_items_treatment_type
      FOREIGN KEY (treatment_type_id) REFERENCES treatment_types (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_episode_plan_items_legacy_ewp'
  ) THEN
    ALTER TABLE episode_plan_items
      ADD CONSTRAINT fk_episode_plan_items_legacy_ewp
      FOREIGN KEY (legacy_episode_work_phase_id) REFERENCES episode_work_phases (id) ON DELETE RESTRICT;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- episode_plan_item_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episode_plan_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id UUID NOT NULL REFERENCES episode_plan_items (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episode_plan_item_events_plan_item_id
  ON episode_plan_item_events (plan_item_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_episode_plan_item_events_actor'
  ) THEN
    ALTER TABLE episode_plan_item_events
      ADD CONSTRAINT fk_episode_plan_item_events_actor
      FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- migration_ewp_anomaly
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_ewp_anomaly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id UUID NOT NULL REFERENCES migration_runs (id) ON DELETE CASCADE,
  episode_work_phase_id UUID NOT NULL,
  reason_code TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_ewp_anomaly_run
  ON migration_ewp_anomaly (migration_run_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_migration_ewp_anomaly_ewp'
  ) THEN
    ALTER TABLE migration_ewp_anomaly
      ADD CONSTRAINT fk_migration_ewp_anomaly_ewp
      FOREIGN KEY (episode_work_phase_id) REFERENCES episode_work_phases (id) ON DELETE RESTRICT;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- appointments: plan item link (nullable in Phases 1–4)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS plan_item_id UUID;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS plan_item_link_batch_id UUID;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS plan_item_linked_at TIMESTAMPTZ;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_appointments_plan_item'
    ) THEN
      ALTER TABLE appointments
        ADD CONSTRAINT fk_appointments_plan_item
        FOREIGN KEY (plan_item_id) REFERENCES episode_plan_items (id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Indexes: episode_work_phases(appointment_id) partial (Phase 3 join prep)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_episode_work_phases_appointment_id_nn
  ON episode_work_phases (appointment_id)
  WHERE appointment_id IS NOT NULL;

COMMIT;
