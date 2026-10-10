-- Epizódonkénti, szöveges klinikai kezelési terv, a munkafázisoktól függetlenül.
BEGIN;
ALTER TABLE patient_episodes
  ADD COLUMN IF NOT EXISTS treatment_plan TEXT,
  ADD COLUMN IF NOT EXISTS treatment_plan_version INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN patient_episodes.treatment_plan IS
  'Az epizód rögzített szöveges kezelési terve. A lépésekből nem generálódik automatikusan.';
COMMENT ON COLUMN patient_episodes.treatment_plan_version IS
  'Optimista zárolás: párhuzamos szerkesztéskor a régi változat nem írhatja felül az újat.';
COMMIT;
