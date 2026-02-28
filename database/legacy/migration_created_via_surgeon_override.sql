-- Add surgeon_override to created_via for audit trail accuracy
-- When sebészorvos users bypass one-hard-next with overrideReason, created_via should reflect their role.
-- Run with: psql -d <db> -f database/migration_created_via_surgeon_override.sql

BEGIN;

-- Drop existing check and add new one including surgeon_override
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_created_via_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_created_via_check
  CHECK (created_via IN ('worklist', 'patient_self', 'admin_override', 'surgeon_override', 'migration', 'google_import'));

COMMIT;
