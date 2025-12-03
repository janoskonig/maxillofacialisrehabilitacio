-- Migration: Add appointment status tracking
-- This allows tracking appointment outcomes: cancelled by doctor/patient, completed, no-show, and late arrivals
-- Run with: psql -d <db> -f database/migration_appointments_status.sql

BEGIN;

-- Add appointment_status column to appointments table
-- Values: 'cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show', NULL (normal/upcoming appointment)
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS appointment_status VARCHAR(30) CHECK (appointment_status IN ('cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show'));

-- Add completion_notes column for brief description of what happened (for completed appointments)
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS completion_notes TEXT;

-- Add is_late column to track if patient was late
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS is_late BOOLEAN DEFAULT false;

-- Add index for appointment_status
CREATE INDEX IF NOT EXISTS idx_appointments_appointment_status 
ON appointments(appointment_status) 
WHERE appointment_status IS NOT NULL;

-- Add index for is_late
CREATE INDEX IF NOT EXISTS idx_appointments_is_late 
ON appointments(is_late) 
WHERE is_late = true;

-- Comments
COMMENT ON COLUMN appointments.appointment_status IS 'Időpont státusza: cancelled_by_doctor (lemondta az orvos), cancelled_by_patient (lemondta a beteg), completed (sikeresen teljesült), no_show (nem jelent meg), NULL (normál/várható időpont)';
COMMENT ON COLUMN appointments.completion_notes IS 'Rövid leírás arról, hogy mi történt az időpont során (sikeresen teljesült esetén)';
COMMENT ON COLUMN appointments.is_late IS 'Igaz, ha a beteg késett az időpontra';

COMMIT;





