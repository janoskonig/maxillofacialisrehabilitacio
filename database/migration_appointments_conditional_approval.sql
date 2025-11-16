-- Migration: Add conditional approval support to appointments
-- This allows admins to create pending appointments that patients can approve/reject via email
-- Run with: psql -d <db> -f database/migration_appointments_conditional_approval.sql

BEGIN;

-- Add approval_status column to appointments table
-- Values: 'pending' (waiting for patient approval), 'approved' (patient approved), 'rejected' (patient rejected), NULL (normal appointment, no approval needed)
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) CHECK (approval_status IN ('pending', 'approved', 'rejected'));

-- Add approval_token for secure email links
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS approval_token VARCHAR(255);

-- Add index for approval_token for fast lookups
CREATE INDEX IF NOT EXISTS idx_appointments_approval_token 
ON appointments(approval_token) 
WHERE approval_token IS NOT NULL;

-- Add index for approval_status
CREATE INDEX IF NOT EXISTS idx_appointments_approval_status 
ON appointments(approval_status) 
WHERE approval_status IS NOT NULL;

-- Comments
COMMENT ON COLUMN appointments.approval_status IS 'Feltételes időpontválasztás státusza: pending (várakozik), approved (elfogadva), rejected (elvetve), NULL (normál időpont)';
COMMENT ON COLUMN appointments.approval_token IS 'Biztonságos token az email linkekhez az időpont elfogadásához/elvetéséhez';

COMMIT;

