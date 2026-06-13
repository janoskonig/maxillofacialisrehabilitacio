BEGIN;

-- Hiányzó betegadat-emlékeztetők (beutaló orvos + legutóbbi fogpótlástanász)
--
-- 1) Új user_tasks.task_type: 'missing_data' — az érintett orvosoknak létrejövő
--    feladat, ha egy betegnél hiányzó (klinikai vagy kutatási) adat van.
-- 2) missing_data_reminder_log — idempotencia / hetente ismétlődő e-mail kapu.
--    Ugyanannak a (beteg, címzett) párnak 7 naponta legfeljebb egy e-mailt küldünk;
--    ha egy hét után is hiányzik az adat, a következő futás új értesítőt küld.

ALTER TABLE user_tasks
  DROP CONSTRAINT IF EXISTS user_tasks_task_type_check;

ALTER TABLE user_tasks
  ADD CONSTRAINT user_tasks_task_type_check
  CHECK (task_type IN (
    'document_upload',
    'ohip14',
    'manual',
    'meeting_action',
    'staff_registration_review',
    'missing_data'
  ));

CREATE TABLE IF NOT EXISTS missing_data_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_role TEXT,
  email_to TEXT,
  missing_summary TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_missing_data_reminder_log_lookup
  ON missing_data_reminder_log (patient_id, recipient_user_id, sent_at DESC);

COMMIT;
