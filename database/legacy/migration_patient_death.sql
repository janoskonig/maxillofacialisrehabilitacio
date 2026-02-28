-- Migration: Add halal_datum field to patients table
-- Run with: psql -d <db> -f database/migration_patient_death.sql

-- Add halal_datum column to patients table
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS halal_datum DATE;

-- Add index for filtering deceased patients
CREATE INDEX IF NOT EXISTS idx_patients_halal_datum ON patients(halal_datum) WHERE halal_datum IS NOT NULL;

-- Comment
COMMENT ON COLUMN patients.halal_datum IS 'Páciens halálának dátuma (opcionális)';

