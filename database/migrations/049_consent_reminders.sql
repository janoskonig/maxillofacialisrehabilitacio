-- Consent reminders: declined research status + daily reminder idempotency log.

-- 1) Allow an explicit 'declined' research consent status (initial refusal,
--    distinct from 'withdrawn' which follows a prior grant).
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_consent_status_check;
ALTER TABLE patients ADD CONSTRAINT patients_consent_status_check
  CHECK (consent_status IS NULL OR consent_status IN (
    'unknown', 'pending', 'granted', 'withdrawn', 'expired', 'declined'
  ));

-- 2) Mirror the new status in the consent event history check.
ALTER TABLE patient_consent_events DROP CONSTRAINT IF EXISTS patient_consent_events_event_type_check;
ALTER TABLE patient_consent_events ADD CONSTRAINT patient_consent_events_event_type_check
  CHECK (event_type IN (
    'pending', 'granted', 'withdrawn', 'expired', 'reconsent_requested', 'declined'
  ));

-- 3) Idempotency log for the daily consent reminder (mirrors ohip_reminder_log).
--    A ~20h cooldown guarantees at most one reminder per patient per day, so the
--    cron window can be wide without double-sending.
CREATE TABLE IF NOT EXISTS consent_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  email_to TEXT,
  needs_gdpr BOOLEAN NOT NULL,
  needs_research BOOLEAN NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_reminder_log_lookup
  ON consent_reminder_log (patient_id, sent_at DESC);
