-- The clinical indication is distinct from the short episode title.
-- Preserve existing values and allow the complete documented reason.
BEGIN;
ALTER TABLE patient_episodes ALTER COLUMN chief_complaint TYPE TEXT;
COMMIT;
