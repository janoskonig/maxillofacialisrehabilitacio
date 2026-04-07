-- Migration 016: Canonical work-phase schema (H1.1)
-- Adds work_phase_catalog, care_pathways.work_phases_json, episode_work_phases.
-- Legacy episode_steps, step_catalog, steps_json remain unchanged (read-only after app cutover).
-- Idempotent: safe to re-run INSERT...ON CONFLICT / UPDATE from legacy sources.
--
-- Run: npm run migrate:work-phase-canonical
--      node scripts/run-all-migrations.js 016_work_phase_canonical.sql
--
-- Rollback reference: database/rollback/016_work_phase_canonical_down.sql

-- -----------------------------------------------------------------------------
-- 1. work_phase_catalog (mirror of step_catalog; work_phase_code = former step_code)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_phase_catalog (
  work_phase_code TEXT PRIMARY KEY CHECK (work_phase_code ~ '^[a-z0-9_]+$'),
  label_hu TEXT NOT NULL,
  label_en TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_work_phase_catalog_is_active
  ON work_phase_catalog (is_active) WHERE is_active = true;

COMMENT ON TABLE work_phase_catalog IS 'work_phase_code → display labels (care_pathways.work_phases_json). Legacy step_catalog remains for audit.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_phase_catalog_updated_by')
     AND EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
     ) THEN
    ALTER TABLE work_phase_catalog
      ADD CONSTRAINT fk_work_phase_catalog_updated_by
      FOREIGN KEY (updated_by) REFERENCES users (id);
  END IF;
END $$;

-- Backfill / sync from legacy catalog (skip if step_catalog not present)
DO $backfill_catalog$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'step_catalog'
  ) THEN
    INSERT INTO work_phase_catalog (work_phase_code, label_hu, label_en, is_active, updated_at, updated_by)
    SELECT sc.step_code, sc.label_hu, sc.label_en, sc.is_active, sc.updated_at, sc.updated_by
    FROM step_catalog sc
    ON CONFLICT (work_phase_code) DO UPDATE SET
      label_hu = EXCLUDED.label_hu,
      label_en = EXCLUDED.label_en,
      is_active = EXCLUDED.is_active,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;
  END IF;
END $backfill_catalog$;

-- -----------------------------------------------------------------------------
-- 2. care_pathways.work_phases_json (canonical JSON; keys use work_phase_code)
-- -----------------------------------------------------------------------------
ALTER TABLE care_pathways ADD COLUMN IF NOT EXISTS work_phases_json JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN care_pathways.work_phases_json IS 'Pathway template items [{work_phase_code, pool, duration_minutes, ...}]. Populated from steps_json; legacy steps_json kept for audit.';

UPDATE care_pathways cp
SET work_phases_json = sub.transformed
FROM (
  SELECT
    id,
    COALESCE(
      (
        SELECT jsonb_agg(
          (elem - 'step_code') || jsonb_build_object('work_phase_code', elem -> 'step_code')
        )
        FROM jsonb_array_elements(cp.steps_json) AS elem
      ),
      '[]'::jsonb
    ) AS transformed
  FROM care_pathways cp
) sub
WHERE cp.id = sub.id;

-- -----------------------------------------------------------------------------
-- 3. episode_work_phases (mirror of episode_steps; same id for 1:1 correlation)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episode_work_phases (
  id UUID PRIMARY KEY,
  episode_id UUID NOT NULL REFERENCES patient_episodes (id) ON DELETE CASCADE,
  work_phase_code VARCHAR(80) NOT NULL,
  pathway_order_index INT NOT NULL,
  pool VARCHAR(20) NOT NULL DEFAULT 'work',
  duration_minutes INT NOT NULL DEFAULT 30,
  default_days_offset INT NOT NULL DEFAULT 7,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduled', 'completed', 'skipped')),
  appointment_id UUID,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  source_episode_pathway_id UUID,
  seq INT,
  custom_label VARCHAR(200),
  tooth_treatment_id UUID,
  merged_into_episode_work_phase_id UUID
);

COMMENT ON TABLE episode_work_phases IS 'Concrete work-phase instances per episode (canonical). Legacy episode_steps retained for audit.';

CREATE INDEX IF NOT EXISTS idx_episode_work_phases_episode_order
  ON episode_work_phases (episode_id, pathway_order_index);

CREATE INDEX IF NOT EXISTS idx_episode_work_phases_status
  ON episode_work_phases (episode_id, status);

CREATE INDEX IF NOT EXISTS idx_episode_work_phases_seq
  ON episode_work_phases (episode_id, seq) WHERE seq IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episode_work_phases_episode_seq
  ON episode_work_phases (episode_id, seq, pathway_order_index);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'episode_pathways'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_ewp_source_episode_pathway'
  ) THEN
    ALTER TABLE episode_work_phases
      ADD CONSTRAINT fk_ewp_source_episode_pathway
      FOREIGN KEY (source_episode_pathway_id) REFERENCES episode_pathways (id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tooth_treatments'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_ewp_tooth_treatment'
  ) THEN
    ALTER TABLE episode_work_phases
      ADD CONSTRAINT fk_ewp_tooth_treatment
      FOREIGN KEY (tooth_treatment_id) REFERENCES tooth_treatments (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ewp_merged_into') THEN
    ALTER TABLE episode_work_phases
      ADD CONSTRAINT fk_ewp_merged_into
      FOREIGN KEY (merged_into_episode_work_phase_id) REFERENCES episode_work_phases (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_work_phases_tooth_treatment_unique
  ON episode_work_phases (episode_id, tooth_treatment_id)
  WHERE tooth_treatment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episode_work_phases_tooth_treatment
  ON episode_work_phases (tooth_treatment_id) WHERE tooth_treatment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episode_work_phases_merged_into
  ON episode_work_phases (merged_into_episode_work_phase_id) WHERE merged_into_episode_work_phase_id IS NOT NULL;

-- Copy / refresh from legacy episode_steps (same primary keys).
-- Optional columns use NULL when absent on episode_steps (older legacy DBs).
DO $sync_episode_work_phases$
DECLARE
  sql TEXT;
  sel_src TEXT := 'NULL::uuid';
  sel_seq TEXT := 'NULL::int';
  sel_lbl TEXT := 'NULL::varchar(200)';
  sel_tt TEXT := 'NULL::uuid';
  sel_mg TEXT := 'NULL::uuid';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'episode_steps'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'episode_steps' AND column_name = 'source_episode_pathway_id'
  ) THEN
    sel_src := 'es.source_episode_pathway_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'episode_steps' AND column_name = 'seq'
  ) THEN
    sel_seq := 'es.seq';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'episode_steps' AND column_name = 'custom_label'
  ) THEN
    sel_lbl := 'es.custom_label';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'episode_steps' AND column_name = 'tooth_treatment_id'
  ) THEN
    sel_tt := 'es.tooth_treatment_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'episode_steps' AND column_name = 'merged_into_episode_step_id'
  ) THEN
    sel_mg := 'es.merged_into_episode_step_id';
  END IF;

  sql :=
    'INSERT INTO episode_work_phases ('
    || 'id, episode_id, work_phase_code, pathway_order_index, pool, duration_minutes,'
    || 'default_days_offset, status, appointment_id, created_at, completed_at,'
    || 'source_episode_pathway_id, seq, custom_label, tooth_treatment_id, merged_into_episode_work_phase_id'
    || ') SELECT '
    || 'es.id, es.episode_id, es.step_code, es.pathway_order_index, es.pool, es.duration_minutes,'
    || 'es.default_days_offset, es.status, es.appointment_id, es.created_at, es.completed_at,'
    || sel_src || ', ' || sel_seq || ', ' || sel_lbl || ', ' || sel_tt || ', ' || sel_mg
    || ' FROM episode_steps es ON CONFLICT (id) DO UPDATE SET '
    || 'episode_id = EXCLUDED.episode_id, work_phase_code = EXCLUDED.work_phase_code, '
    || 'pathway_order_index = EXCLUDED.pathway_order_index, pool = EXCLUDED.pool, '
    || 'duration_minutes = EXCLUDED.duration_minutes, default_days_offset = EXCLUDED.default_days_offset, '
    || 'status = EXCLUDED.status, appointment_id = EXCLUDED.appointment_id, '
    || 'created_at = EXCLUDED.created_at, completed_at = EXCLUDED.completed_at, '
    || 'source_episode_pathway_id = EXCLUDED.source_episode_pathway_id, seq = EXCLUDED.seq, '
    || 'custom_label = EXCLUDED.custom_label, tooth_treatment_id = EXCLUDED.tooth_treatment_id, '
    || 'merged_into_episode_work_phase_id = EXCLUDED.merged_into_episode_work_phase_id';

  EXECUTE sql;
END $sync_episode_work_phases$;
