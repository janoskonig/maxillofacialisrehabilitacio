-- Rollback for database/migrations/026_assert_appointment_status_check.sql
-- WARNING: This drops the taxonomy guard. Don't run unless you have a
-- replacement constraint or are knowingly unwinding the enforcement layer.

BEGIN;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_appointment_status_check;

DELETE FROM node_migrations WHERE name = '026_assert_appointment_status_check.sql';

COMMIT;
