-- Patient snapshots table for versioning and rollback capability
-- Run with: psql -d <db> -f database/migration_patient_snapshots.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS patient_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    snapshot_data JSONB NOT NULL, -- Full patient object at the time of save
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- User who created the snapshot
    source VARCHAR(20) NOT NULL CHECK (source IN ('manual', 'auto')), -- Save source (only 'manual' should be used for snapshots)
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_snapshots_patient_id ON patient_snapshots(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_snapshots_created_at ON patient_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_snapshots_patient_created_at ON patient_snapshots(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_snapshots_created_by_user_id ON patient_snapshots(created_by_user_id);

-- Comments
COMMENT ON TABLE patient_snapshots IS 'Beteg adatok snapshot verziói - rollback és audit trail céljára';
COMMENT ON COLUMN patient_snapshots.snapshot_data IS 'Teljes beteg objektum a mentés időpontjában (JSONB)';
COMMENT ON COLUMN patient_snapshots.created_by_user_id IS 'A felhasználó ID-ja, aki a snapshotot létrehozta (users.id)';
COMMENT ON COLUMN patient_snapshots.source IS 'Mentés forrása (manual vagy auto, de csak manual esetén kell snapshot)';
COMMENT ON COLUMN patient_snapshots.created_at IS 'Snapshot létrehozásának időpontja';
