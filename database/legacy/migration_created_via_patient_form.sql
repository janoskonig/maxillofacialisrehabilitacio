-- Add patient_form to created_via for audit trail accuracy
-- When staff books from patient form (AppointmentBookingSection, AppointmentBooking), created_via should reflect the origin.
-- Run with: psql -d <db> -f database/migration_created_via_patient_form.sql

BEGIN;

-- Drop both possible constraint names (scheduling_v2 may have created _check1 inline)
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_created_via_check;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_created_via_check1;
ALTER TABLE appointments ADD CONSTRAINT appointments_created_via_check
  CHECK (created_via IN ('worklist', 'patient_form', 'patient_self', 'admin_override', 'surgeon_override', 'migration', 'google_import'));

COMMIT;
