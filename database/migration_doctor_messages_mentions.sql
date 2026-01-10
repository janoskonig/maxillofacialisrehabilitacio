-- Doctor messages mentions migration
-- Adds mentioned_patient_ids field to store patient mentions in doctor-to-doctor messages
-- Run with: psql -d <db> -f database/migration_doctor_messages_mentions.sql

BEGIN;

-- Add mentioned_patient_ids column to doctor_messages table
ALTER TABLE doctor_messages 
ADD COLUMN IF NOT EXISTS mentioned_patient_ids JSONB DEFAULT '[]'::jsonb;

-- Create GIN index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_doctor_messages_mentioned_patients 
ON doctor_messages USING GIN (mentioned_patient_ids);

-- Comments
COMMENT ON COLUMN doctor_messages.mentioned_patient_ids IS 'Beteg ID-k tömbje, akikre hivatkoznak az üzenetben (@vezeteknev+keresztnev formátum)';

COMMIT;

