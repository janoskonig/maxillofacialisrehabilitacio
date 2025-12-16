-- Migration: Add appointment type tracking
-- This allows categorizing appointments as: first consultation, work phase, or control
-- Run with: psql -d <db> -f database/migration_appointments_type.sql

BEGIN;

-- Add appointment_type column to appointments table
-- Values: 'elso_konzultacio' (first consultation), 'munkafazis' (work phase), 'kontroll' (control), NULL (not specified)
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS appointment_type VARCHAR(30) CHECK (appointment_type IN ('elso_konzultacio', 'munkafazis', 'kontroll'));

-- Add index for appointment_type
CREATE INDEX IF NOT EXISTS idx_appointments_appointment_type 
ON appointments(appointment_type) 
WHERE appointment_type IS NOT NULL;

-- Comments
COMMENT ON COLUMN appointments.appointment_type IS 'Időpont típusa: elso_konzultacio (első konzultáció), munkafazis (munkafázis - valami készül, ez a vizit egy lépcsője), kontroll (már kész van minden vagy legalábbis egy milestone-on túl vagyunk), NULL (nincs megadva)';

COMMIT;
