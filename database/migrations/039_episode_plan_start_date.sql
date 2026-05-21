-- Kezdődátum (tervezési horgony) epizódonként: a munkafázis ablakok
-- default_days_offset számítása ettől indul, ha még nincs teljesített fázis / időpont.
ALTER TABLE patient_episodes
  ADD COLUMN IF NOT EXISTS plan_start_date TIMESTAMPTZ;

COMMENT ON COLUMN patient_episodes.plan_start_date IS
  'Tervezési kezdődátum a munkafázis ablakokhoz. Ha nincs teljesített fázis vagy lezárt időpont, ez az anchor a default_days_offset számításhoz (opened_at helyett).';
