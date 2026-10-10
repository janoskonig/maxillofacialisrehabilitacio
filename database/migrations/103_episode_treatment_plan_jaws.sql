-- Külön felső és alsó klinikai terv. A korábbi közös szöveg változatlanul megmarad.
BEGIN;
ALTER TABLE patient_episodes
  ADD COLUMN IF NOT EXISTS treatment_plan_upper TEXT,
  ADD COLUMN IF NOT EXISTS treatment_plan_lower TEXT;
COMMENT ON COLUMN patient_episodes.treatment_plan_upper IS 'Az epizód felső állcsontjának rögzített klinikai kezelési terve.';
COMMENT ON COLUMN patient_episodes.treatment_plan_lower IS 'Az epizód alsó állcsontjának rögzített klinikai kezelési terve.';
COMMIT;
