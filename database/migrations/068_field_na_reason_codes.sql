BEGIN;

-- Strukturált hiányzási okkód a patient_field_na jelölésekhez.
--
-- Eddig csak szabad szöveges `reason` volt; a statisztikai elemzéshez
-- (MAR/MNAR osztályozás) kódolt ok kell:
--   nem_alkalmazhato  — a mező a betegre nem értelmezhető
--   nem_ismert        — kérdezték, de nem deríthető ki
--   beteg_megtagadta  — a beteg nem kívánt válaszolni (MNAR-gyanús)
--   meg_nem_kerdeztek — még nem került rá sor (MCAR-közeli)
--
-- Backfill: a meglévő jelölések az eredeti tábla-szemantika szerint
-- N/A ("nem értelmezhető") értelemben születtek → nem_alkalmazhato.
-- A szabad szöveges `reason` megmarad opcionális megjegyzésnek.

ALTER TABLE patient_field_na
  ADD COLUMN IF NOT EXISTS reason_code TEXT NOT NULL DEFAULT 'nem_alkalmazhato';

ALTER TABLE patient_field_na
  DROP CONSTRAINT IF EXISTS patient_field_na_reason_code_check;

ALTER TABLE patient_field_na
  ADD CONSTRAINT patient_field_na_reason_code_check
  CHECK (reason_code IN ('nem_alkalmazhato', 'nem_ismert', 'beteg_megtagadta', 'meg_nem_kerdeztek'));

COMMIT;
