-- Migration: stage_steps — stádium ↔ részlépés kapcsolat (stage_catalog ↔ step_catalog)
-- Run after: migration_step_catalog.sql, migration_episode_stage_milestone.sql
-- stage_code: API validálja ∈ (SELECT DISTINCT code FROM stage_catalog)
-- step_code: FK → step_catalog ON DELETE RESTRICT

BEGIN;

CREATE TABLE IF NOT EXISTS stage_steps (
  stage_code VARCHAR(50) NOT NULL,
  step_code TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  PRIMARY KEY (stage_code, step_code),
  CONSTRAINT fk_stage_steps_step
    FOREIGN KEY (step_code) REFERENCES step_catalog(step_code)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stage_steps_stage ON stage_steps(stage_code);
CREATE INDEX IF NOT EXISTS idx_stage_steps_stage_order ON stage_steps(stage_code, order_index);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_steps_stage_order
  ON stage_steps(stage_code, order_index);

COMMENT ON TABLE stage_steps IS 'Stádiumok és részlépések kapcsolata — admin szerkeszthető';

-- Kezdeti seed (admin szerkesztheti később)
INSERT INTO stage_steps (stage_code, step_code, order_index) VALUES
  ('STAGE_1', 'consult_1', 0), ('STAGE_1', 'diagnostic', 1),
  ('STAGE_5', 'impression_1', 0), ('STAGE_5', 'try_in_1', 1),
  ('STAGE_5', 'try_in_2', 2), ('STAGE_5', 'delivery', 3),
  ('STAGE_7', 'control_6m', 0), ('STAGE_7', 'control_12m', 1)
ON CONFLICT (stage_code, step_code) DO UPDATE SET order_index = EXCLUDED.order_index;

COMMIT;
