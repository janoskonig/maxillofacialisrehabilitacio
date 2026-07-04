BEGIN;

-- Beteg-önkitöltési emlékeztetők naplója (heti cooldownhoz).
--
-- A beteg által önkitölthető mezők (életmód-anamnézis, fogpótlás-elégedettség)
-- hiányáról a rendszer a BETEGET nudge-olja a portálon (feladat + push +
-- e-mail) az OHIP-emlékeztetők mintájára. Ez a tábla az e-mail küldések
-- naplója: ugyanannak a betegnek 7 napon belül nem megy újabb levél.

CREATE TABLE IF NOT EXISTS patient_selffill_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  email_to TEXT,
  missing_keys TEXT[] NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_selffill_reminder_log_patient
  ON patient_selffill_reminder_log (patient_id, sent_at DESC);

COMMIT;
