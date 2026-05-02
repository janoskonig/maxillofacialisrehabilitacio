-- Rollback for database/migrations/025_appointment_work_phase_link.sql
-- NOT registered in node_migrations — run manually on a clone first.
--
-- Safe to drop: no application reads/writes use work_phase_id as the SOLE
-- identity in Phase 3 (legacy step_code/step_seq still populated). Once
-- Phase 6 of the plan is complete, this rollback is destructive.

BEGIN;

DROP INDEX IF EXISTS idx_appointments_unique_work_phase_active;
DROP INDEX IF EXISTS idx_appointments_work_phase_id_nn;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS fk_appointments_work_phase;
ALTER TABLE appointments DROP COLUMN IF EXISTS work_phase_id;

DROP INDEX IF EXISTS idx_slot_intents_unique_open_work_phase;
DROP INDEX IF EXISTS idx_slot_intents_work_phase_id_nn;

ALTER TABLE slot_intents DROP CONSTRAINT IF EXISTS fk_slot_intents_work_phase;
ALTER TABLE slot_intents DROP COLUMN IF EXISTS work_phase_id;

DELETE FROM node_migrations WHERE name = '025_appointment_work_phase_link.sql';

COMMIT;
