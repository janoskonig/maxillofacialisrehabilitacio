-- Migration: step_catalog — step_code → label szótár
-- Run after: migration_pathway_trauma_veleszületett.sql
-- step_code = ^[a-z0-9_]+$ konvenció

BEGIN;

CREATE TABLE IF NOT EXISTS step_catalog (
  step_code TEXT PRIMARY KEY CHECK (step_code ~ '^[a-z0-9_]+$'),
  label_hu TEXT NOT NULL,
  label_en TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_step_catalog_is_active ON step_catalog(is_active) WHERE is_active = true;

COMMENT ON TABLE step_catalog IS 'step_code → megjelenítési címke szótár (care_pathways.steps_json step_code-okhoz)';

-- Seed: teljes STEP_LABELS készlet (lib/virtual-appointments-service.ts)
INSERT INTO step_catalog (step_code, label_hu) VALUES
  ('consult_1', 'Első konzultáció'),
  ('diagnostic', 'Diagnosztika'),
  ('impression_1', 'Lenyomat 1'),
  ('try_in_1', 'Próba 1'),
  ('try_in_2', 'Próba 2'),
  ('delivery', 'Átadás'),
  ('control_6m', '6 hónapos kontroll'),
  ('control_12m', '12 hónapos kontroll')
ON CONFLICT (step_code) DO UPDATE SET
  label_hu = EXCLUDED.label_hu,
  updated_at = now();

COMMIT;
