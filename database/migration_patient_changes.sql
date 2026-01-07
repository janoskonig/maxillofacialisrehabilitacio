-- Patient changes tracking table for detailed audit trail
-- Run with: psql -d <db> -f database/migration_patient_changes.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS patient_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    field_display_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_changes_patient_id ON patient_changes(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_changes_changed_at ON patient_changes(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_changes_changed_by ON patient_changes(changed_by);
CREATE INDEX IF NOT EXISTS idx_patient_changes_patient_changed_at ON patient_changes(patient_id, changed_at DESC);

-- Comments
COMMENT ON TABLE patient_changes IS 'Részletes változáskövetés a páciens adatokhoz - minden mező változás külön rekordként';
COMMENT ON COLUMN patient_changes.field_name IS 'Adatbázis mező neve (pl. nev, taj)';
COMMENT ON COLUMN patient_changes.field_display_name IS 'Megjelenített mező név (pl. Név, TAJ szám)';
COMMENT ON COLUMN patient_changes.old_value IS 'Régi érték (JSON stringify ha objektum)';
COMMENT ON COLUMN patient_changes.new_value IS 'Új érték (JSON stringify ha objektum)';
COMMENT ON COLUMN patient_changes.changed_by IS 'Módosító felhasználó email címe';

