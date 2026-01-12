-- Migration: Add recipient_doctor_id to messages table
-- This allows patients to send messages to any doctor, not just their treating doctor
-- Run with: psql -d <db> -f database/migration_messages_recipient_doctor.sql

-- Add recipient_doctor_id column (nullable, defaults to treating doctor if not specified)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS recipient_doctor_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_messages_recipient_doctor_id ON messages(recipient_doctor_id);

-- Add comment
COMMENT ON COLUMN messages.recipient_doctor_id IS 'Címzett orvos ID-ja (opcionális, ha NULL, akkor a beteg kezelőorvosa a címzett)';
