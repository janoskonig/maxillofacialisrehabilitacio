-- Legal/GDPR hardening:
--  1) Privacy-notice acknowledgement (Art. 13 information notice, NOT consent)
--  2) Legal guardian columns for minors
--  3) IP / user-agent on research consent events (Art. 7(1) demonstrability parity)
--  4) Enable the unified audit log feature flag

-- 1) Privacy notice acknowledgement -------------------------------------------
-- Records that the patient was *informed* (acknowledged the privacy notice).
-- This is the lawful basis 9(2)(h) information duty, not withdrawable consent.
CREATE TABLE IF NOT EXISTS privacy_notice_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  policy_version VARCHAR(20) NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  on_behalf JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_privacy_notice_ack_patient
  ON privacy_notice_acknowledgements (patient_id, acknowledged_at DESC);

-- Backfill: treat existing active 'data_processing' GDPR consent rows as an
-- acknowledgement of the CURRENT policy version, so the rollout does not blast
-- daily reminders to already-registered patients. (Legal sign-off: a future
-- policy version bump correctly re-prompts; reconcile if re-ack is preferred.)
INSERT INTO privacy_notice_acknowledgements (patient_id, policy_version, acknowledged_at, ip_address, user_agent)
SELECT DISTINCT ON (gc.patient_id)
       gc.patient_id, '1.1', gc.given_at, gc.ip_address, gc.user_agent
FROM gdpr_consents gc
WHERE gc.patient_id IS NOT NULL
  AND gc.purpose = 'data_processing'
  AND gc.withdrawn_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM privacy_notice_acknowledgements pna
    WHERE pna.patient_id = gc.patient_id AND pna.policy_version = '1.1'
  )
ORDER BY gc.patient_id, gc.given_at DESC;

-- 2) Legal guardian columns for minors ----------------------------------------
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS torvenyes_kepviselo_nev VARCHAR(255),
  ADD COLUMN IF NOT EXISTS torvenyes_kepviselo_kapcsolat VARCHAR(64),
  ADD COLUMN IF NOT EXISTS torvenyes_kepviselo_email VARCHAR(255);

-- 3) IP / user-agent on research consent events -------------------------------
ALTER TABLE patient_consent_events
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- 4) Enable the unified append-only audit log ---------------------------------
INSERT INTO compliance_feature_flags (key, enabled, description)
VALUES ('unified_audit_events', true, 'Write critical transitions to audit_events')
ON CONFLICT (key) DO UPDATE SET enabled = true, updated_at = CURRENT_TIMESTAMP;
