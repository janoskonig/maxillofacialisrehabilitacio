-- Migration: Add approved_at column to appointments table
-- This tracks when a conditional appointment was approved by the patient
-- Run with: psql -d <db> -f database/migration_appointments_approved_at.sql

BEGIN;

-- Add approved_at column to appointments table
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- Add index for approved_at for fast lookups
CREATE INDEX IF NOT EXISTS idx_appointments_approved_at 
ON appointments(approved_at) 
WHERE approved_at IS NOT NULL;

-- Comments
COMMENT ON COLUMN appointments.approved_at IS 'Időpont, amikor a feltételes időpontot a beteg elfogadta';

COMMIT;
