-- Patient portal tokens table for magic link authentication
-- Run with: psql -d <db> -f database/migration_patient_portal_tokens.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS patient_portal_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    token_type VARCHAR(50) NOT NULL DEFAULT 'magic_link', -- 'magic_link' or 'email_verification'
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) -- Store IP for security/audit
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_portal_tokens_token ON patient_portal_tokens(token);
CREATE INDEX IF NOT EXISTS idx_patient_portal_tokens_patient_id ON patient_portal_tokens(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_portal_tokens_expires_at ON patient_portal_tokens(expires_at);

-- Clean up expired tokens (can be run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_portal_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM patient_portal_tokens 
    WHERE expires_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE patient_portal_tokens IS 'Patient portal authentication tokens for magic link login';
COMMENT ON COLUMN patient_portal_tokens.token_type IS 'Type: magic_link (for login) or email_verification (for new patient registration)';
COMMENT ON COLUMN patient_portal_tokens.expires_at IS 'Token expiration time (typically 48 hours for magic_link, 7 days for email_verification)';








