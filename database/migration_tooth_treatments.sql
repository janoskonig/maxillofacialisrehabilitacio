-- Migration: tooth_treatment_catalog + tooth_treatments
-- Fog-szintű kezelési igények: katalógus (admin-kezelt) és beteg-fog-kezelés kapcsolat
-- Safe to re-run (idempotent). Clears any aborted transaction first.

-- Clear any lingering aborted transaction from a previous failed run
ROLLBACK;

BEGIN;

-- 1) tooth_treatment_catalog — admin-managed list of per-tooth treatment types
--    default_care_pathway_id FK added conditionally (care_pathways may not exist yet)
CREATE TABLE IF NOT EXISTS tooth_treatment_catalog (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z0-9_]+$'),
  label_hu TEXT NOT NULL,
  label_en TEXT,
  default_care_pathway_id UUID,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conditionally add FK to care_pathways if that table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'care_pathways'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'tooth_treatment_catalog'
      AND c.conname = 'fk_ttc_care_pathway'
  ) THEN
    ALTER TABLE tooth_treatment_catalog
      ADD CONSTRAINT fk_ttc_care_pathway
      FOREIGN KEY (default_care_pathway_id) REFERENCES care_pathways(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tooth_treatment_catalog_active
  ON tooth_treatment_catalog(sort_order) WHERE is_active = true;

-- Seed
INSERT INTO tooth_treatment_catalog (code, label_hu, sort_order) VALUES
  ('tomes',              'Tömés',               1),
  ('gyokerkezeles',      'Gyökérkezelés',       2),
  ('huzas',              'Húzás',               3),
  ('korona',             'Korona',              4),
  ('csiszolas',          'Csiszolás',           5),
  ('hid_pillerkezeles',  'Híd pillerkezelés',   6),
  ('devitalizalas',      'Devitalizálás',       7),
  ('csonk_felepites',    'Csonkfelépítés',      8)
ON CONFLICT (code) DO UPDATE SET
  label_hu   = EXCLUDED.label_hu,
  sort_order = EXCLUDED.sort_order;

-- 2) tooth_treatments — per-patient, per-tooth treatment needs
CREATE TABLE IF NOT EXISTS tooth_treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tooth_number INT NOT NULL CHECK (tooth_number BETWEEN 11 AND 48),
  treatment_code TEXT NOT NULL REFERENCES tooth_treatment_catalog(code),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'episode_linked', 'completed')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- episode_id FK added conditionally (patient_episodes may not exist yet)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tooth_treatments' AND column_name = 'episode_id'
  ) THEN
    ALTER TABLE tooth_treatments ADD COLUMN episode_id UUID;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patient_episodes'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'tooth_treatments'
      AND c.conname = 'fk_tt_episode'
  ) THEN
    ALTER TABLE tooth_treatments
      ADD CONSTRAINT fk_tt_episode
      FOREIGN KEY (episode_id) REFERENCES patient_episodes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Partial unique: same tooth + treatment only once while not completed
CREATE UNIQUE INDEX IF NOT EXISTS idx_tooth_treatments_active_unique
  ON tooth_treatments(patient_id, tooth_number, treatment_code)
  WHERE (status != 'completed');

CREATE INDEX IF NOT EXISTS idx_tooth_treatments_patient
  ON tooth_treatments(patient_id);
CREATE INDEX IF NOT EXISTS idx_tooth_treatments_episode
  ON tooth_treatments(episode_id) WHERE episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tooth_treatments_pending
  ON tooth_treatments(patient_id) WHERE status = 'pending';

COMMIT;
