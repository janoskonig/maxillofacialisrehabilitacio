-- Migration: Add alternative time slots support to appointments
-- This allows admins to offer alternative time slots when creating conditional appointments
-- Run with: psql -d <db> -f database/migration_appointments_alternative_slots.sql

BEGIN;

-- Add alternative_time_slot_ids column to appointments table
-- This stores an array of time slot IDs as JSONB
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS alternative_time_slot_ids JSONB DEFAULT '[]'::jsonb;

-- Add current_alternative_index to track which alternative is currently being shown
-- NULL means showing the primary time slot, 0 means showing first alternative, etc.
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS current_alternative_index INTEGER DEFAULT NULL;

-- Add index for alternative_time_slot_ids
CREATE INDEX IF NOT EXISTS idx_appointments_alternative_time_slot_ids 
ON appointments USING GIN (alternative_time_slot_ids)
WHERE alternative_time_slot_ids IS NOT NULL AND jsonb_array_length(alternative_time_slot_ids) > 0;

-- Comments
COMMENT ON COLUMN appointments.alternative_time_slot_ids IS 'Alternatív időpontok ID-k tömbje (JSONB), amelyeket a betegnek fel lehet ajánlani';
COMMENT ON COLUMN appointments.current_alternative_index IS 'Jelenleg mutatott alternatív időpont indexe (NULL = elsődleges időpont, 0 = első alternatíva, stb.)';

COMMIT;

