-- Migration: patient_episodes.treatment_type_id (epizód-szintű kezeléstípus)
-- Run after: migration_reason_treatment_type.sql (treatment_types létezik)
-- 3-lépéses FK: ADD COLUMN → INDEX → pg_constraint (drift elkerülésére)
-- Idempotens.

BEGIN;

-- 1) Oszlop
ALTER TABLE patient_episodes
  ADD COLUMN IF NOT EXISTS treatment_type_id UUID;

-- 2) Index
CREATE INDEX IF NOT EXISTS idx_patient_episodes_treatment_type_id
  ON patient_episodes(treatment_type_id);

-- 3) FK constraint (pg_constraint ellenőrzéssel)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_patient_episodes_treatment_type_id'
  ) THEN
    ALTER TABLE patient_episodes
      ADD CONSTRAINT fk_patient_episodes_treatment_type_id
      FOREIGN KEY (treatment_type_id) REFERENCES treatment_types(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
