-- Add patient_form to created_via for audit trail accuracy
-- When staff books from patient form (AppointmentBookingSection, AppointmentBooking), created_via should reflect the origin.
-- Run with: psql -d <db> -f database/migration_created_via_patient_form.sql

BEGIN;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_created_via_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_created_via_check
  CHECK (created_via IN ('worklist', 'patient_form', 'patient_self', 'admin_override', 'surgeon_override', 'migration', 'google_import'));

COMMIT;
