-- GDPR Consent Tracking
-- Stores explicit consent records for data processing, with versioning and withdrawal support

BEGIN;

CREATE TABLE IF NOT EXISTS gdpr_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Polymorphic subject: either a patient or a staff user
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- What they consented to
    purpose VARCHAR(100) NOT NULL CHECK (purpose IN (
        'data_processing',        -- General data processing consent (registration)
        'health_data_processing', -- Special category health data (Art. 9)
        'ai_processing',          -- OpenAI anamnesis summary
        'error_tracking',         -- Sentry error tracking
        'google_calendar'         -- Google Calendar integration
    )),
    
    -- Which version of the privacy policy was in effect
    policy_version VARCHAR(20) NOT NULL DEFAULT '1.0',
    
    given_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    withdrawn_at TIMESTAMPTZ,
    
    ip_address INET,
    user_agent TEXT,
    
    CONSTRAINT chk_subject CHECK (
        (patient_id IS NOT NULL AND user_id IS NULL) OR
        (patient_id IS NULL AND user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_gdpr_consents_patient ON gdpr_consents(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gdpr_consents_user ON gdpr_consents(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gdpr_consents_purpose ON gdpr_consents(purpose);
CREATE INDEX IF NOT EXISTS idx_gdpr_consents_active ON gdpr_consents(patient_id, purpose) WHERE withdrawn_at IS NULL;

COMMIT;
