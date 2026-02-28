-- Migration: reason vs treatment_type (care_pathways)
-- Run after: migration_pathway_governance.sql
-- DDL sorrend kötelező: treatment_types → seed → oszlop → FK → reason nullable → CHECK
-- Idempotens: oszlop IF NOT EXISTS, FK pg_constraint ellenőrzéssel, reason feltételes DDL

BEGIN;

-- 1) treatment_types előbb (FK referencia miatt)
CREATE TABLE IF NOT EXISTS treatment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  label_hu VARCHAR(255) NOT NULL
);

-- 2) Seed
INSERT INTO treatment_types (code, label_hu) VALUES
  ('zarolemez', 'Zárólemez'),
  ('reszleges_akrilat', 'Részleges akrilátlemezes fogpótlás'),
  ('teljes_lemez', 'Teljes lemezes fogpótlás'),
  ('fedolemezes', 'Fedőlemezes fogpótlás'),
  ('kapocselhorgonyzasu_reszleges', 'Kapocselhorgonyzású részleges fémlemezes fogpótlás'),
  ('kombinalt_kapoccsal', 'Kombinált fogpótlás kapocselhorgonyzással'),
  ('kombinalt_rejtett', 'Kombinált fogpótlás rejtett elhorgonyzási eszközzel'),
  ('rogzitett_fogakon', 'Rögzített fogpótlás fogakon elhorgonyozva'),
  ('cementezett_implant', 'Cementezett rögzítésű implantációs korona/híd'),
  ('csavarozott_implant', 'Csavarozott rögzítésű implantációs korona/híd'),
  ('sebeszi_sablon', 'Sebészi sablon készítése')
ON CONFLICT (code) DO NOTHING;

-- 3a) Oszlop — IF NOT EXISTS (REFERENCES nélkül; ADD COLUMN IF NOT EXISTS ... REFERENCES NOP ha oszlop már van → FK hiányzik)
ALTER TABLE care_pathways ADD COLUMN IF NOT EXISTS treatment_type_id UUID;

-- 3b) FK constraint külön, feltételes (ugyanaz az elv mint reason DROP NOT NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'care_pathways'
      AND c.conname = 'fk_care_pathways_treatment_type_id'
  ) THEN
    ALTER TABLE care_pathways
      ADD CONSTRAINT fk_care_pathways_treatment_type_id
      FOREIGN KEY (treatment_type_id) REFERENCES treatment_types(id);
  END IF;
END $$;

-- 4) reason NULLABLE — feltételes DDL (idempotens, deploy-safe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'care_pathways'
      AND column_name = 'reason' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE care_pathways ALTER COLUMN reason DROP NOT NULL;
  END IF;
END $$;

-- 5) CHECK: pontosan az egyik NOT NULL
ALTER TABLE care_pathways DROP CONSTRAINT IF EXISTS chk_reason_xor_treatment_type;
ALTER TABLE care_pathways ADD CONSTRAINT chk_reason_xor_treatment_type
  CHECK (
    (reason IS NOT NULL AND treatment_type_id IS NULL)
    OR (reason IS NULL AND treatment_type_id IS NOT NULL)
  );

COMMIT;
