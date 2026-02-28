-- Events table for PHI-free event logging (autosave, manualsave, etc.)
-- Run with: psql -d <db> -f database/migration_events.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,
    metadata JSONB NOT NULL,
    correlation_id VARCHAR(255),
    user_id_hash VARCHAR(100), -- Hashed user ID (not raw email)
    patient_id_hash VARCHAR(100), -- Hashed patient ID (not raw UUID)
    page VARCHAR(500), -- Page path where event occurred
    app_version VARCHAR(50), -- App version if available
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_events_patient_id_hash ON events(patient_id_hash);
CREATE INDEX IF NOT EXISTS idx_events_type_created_at ON events(type, created_at DESC);

-- Comments
COMMENT ON TABLE events IS 'PHI-mentes event logok (autosave, manualsave, stb.)';
COMMENT ON COLUMN events.type IS 'Event típusa (pl. autosave_attempt, autosave_success, autosave_fail)';
COMMENT ON COLUMN events.metadata IS 'Event metadata (JSONB, PHI-mentes)';
COMMENT ON COLUMN events.correlation_id IS 'Correlation ID a request trace-hoz';
COMMENT ON COLUMN events.user_id_hash IS 'Hashelt user ID (nem raw email)';
COMMENT ON COLUMN events.patient_id_hash IS 'Hashelt patient ID (nem raw UUID)';
