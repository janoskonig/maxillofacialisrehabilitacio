-- Migration: Add dentist_email to appointments table
-- This stores the email of the dentist (fogpótlástanász) who created the time slot
-- Run with: psql -d <db> -f database/migration_appointments_dentist_email.sql

BEGIN;

-- Add dentist_email column to appointments table
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS dentist_email VARCHAR(255);

-- Update existing appointments with dentist email from time slot
UPDATE appointments a
SET dentist_email = u.email
FROM available_time_slots ats
JOIN users u ON ats.user_id = u.id
WHERE a.time_slot_id = ats.id
  AND a.dentist_email IS NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_appointments_dentist_email ON appointments(dentist_email);

-- Update comment
COMMENT ON COLUMN appointments.dentist_email IS 'A fogpótlástanász email címe, aki kiírta az időpontot';
COMMENT ON COLUMN appointments.created_by IS 'A sebészorvos vagy admin email címe, aki lefoglalta az időpontot';

COMMIT;

