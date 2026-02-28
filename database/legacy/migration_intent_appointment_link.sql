-- Migration: Intent ↔ Appointment link + step tracking on appointments
-- Enables demand projection: appointments.slot_intent_id (1:1 FK), step_code/step_seq,
-- slot_intents.source_pathway_hash for projector drift detection.
-- Run with: psql -d <db> -f database/migration_intent_appointment_link.sql

BEGIN;

-- 1) appointments.slot_intent_id — one intent maps to at most one appointment
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS slot_intent_id UUID REFERENCES slot_intents(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_slot_intent
  ON appointments(slot_intent_id)
  WHERE slot_intent_id IS NOT NULL;

-- 2) appointments.step_code + step_seq — which pathway step this appointment fulfills
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS step_code VARCHAR(50);
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS step_seq INT;

-- 3) Partial UNIQUE: max 1 pending appointment per step per episode
-- Allows: completed + new pending (rework), no_show + new pending (re-booking), cancelled + new pending
-- Blocks: two simultaneous pending appointments for the same step
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_pending_step
  ON appointments(episode_id, step_code, step_seq)
  WHERE episode_id IS NOT NULL
    AND step_code IS NOT NULL
    AND step_seq IS NOT NULL
    AND appointment_status IS NULL;

-- 4) slot_intents.source_pathway_hash — projector uses to detect pathway drift
ALTER TABLE slot_intents
  ADD COLUMN IF NOT EXISTS source_pathway_hash VARCHAR(64);

-- 5) Backfill: existing open intents get their pathway hash
UPDATE slot_intents si
SET source_pathway_hash = sub.pathway_hash
FROM (
  SELECT si2.id,
         encode(digest(cp.steps_json::text, 'sha256'), 'hex') as pathway_hash
  FROM slot_intents si2
  JOIN patient_episodes pe ON si2.episode_id = pe.id
  JOIN care_pathways cp ON pe.care_pathway_id = cp.id
  WHERE si2.source_pathway_hash IS NULL AND si2.state = 'open'
) sub
WHERE si.id = sub.id;

COMMIT;
