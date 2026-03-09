-- Migration: Add tooth_treatment_id and merged_into_episode_step_id to episode_steps
-- Enables: fog-szintű kezelések a pathway lépéssorban + lépések összevonása (merge)
-- Run with Node.js: npm run migrate:pathway-tooth-merge
-- Or: node scripts/run-migration.js database/migrations/008_episode_steps_tooth_treatment_merge.sql

DO $$
BEGIN
  -- 1. tooth_treatment_id — links an episode_step to a specific tooth treatment
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'episode_steps' AND column_name = 'tooth_treatment_id'
  ) THEN
    ALTER TABLE episode_steps ADD COLUMN tooth_treatment_id UUID;
  END IF;

  -- 2. merged_into_episode_step_id — self-FK: this step is merged into another step
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'episode_steps' AND column_name = 'merged_into_episode_step_id'
  ) THEN
    ALTER TABLE episode_steps ADD COLUMN merged_into_episode_step_id UUID;
  END IF;

  -- 3. FK: tooth_treatment_id -> tooth_treatments(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tooth_treatments'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_es_tooth_treatment'
  ) THEN
    ALTER TABLE episode_steps
      ADD CONSTRAINT fk_es_tooth_treatment
      FOREIGN KEY (tooth_treatment_id) REFERENCES tooth_treatments(id) ON DELETE SET NULL;
  END IF;

  -- 4. Self-FK: merged_into_episode_step_id -> episode_steps(id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_es_merged_into'
  ) THEN
    ALTER TABLE episode_steps
      ADD CONSTRAINT fk_es_merged_into
      FOREIGN KEY (merged_into_episode_step_id) REFERENCES episode_steps(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Unique partial index: one tooth_treatment per episode in episode_steps
CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_steps_tooth_treatment_unique
  ON episode_steps (episode_id, tooth_treatment_id)
  WHERE tooth_treatment_id IS NOT NULL;

-- 6. Partial indexes for lookups
CREATE INDEX IF NOT EXISTS idx_episode_steps_tooth_treatment
  ON episode_steps (tooth_treatment_id) WHERE tooth_treatment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episode_steps_merged_into
  ON episode_steps (merged_into_episode_step_id) WHERE merged_into_episode_step_id IS NOT NULL;
