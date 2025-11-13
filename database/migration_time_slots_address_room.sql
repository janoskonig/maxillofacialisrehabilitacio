-- Migration: Add address (cim) and room number (teremszam) to time slots
-- Run with: psql -d <db> -f database/migration_time_slots_address_room.sql

BEGIN;

-- Add address column to available_time_slots
ALTER TABLE available_time_slots 
ADD COLUMN IF NOT EXISTS cim VARCHAR(255);

-- Add room number column to available_time_slots
ALTER TABLE available_time_slots 
ADD COLUMN IF NOT EXISTS teremszam VARCHAR(50);

-- Comments
COMMENT ON COLUMN available_time_slots.cim IS 'Az időpont címe/helyszíne';
COMMENT ON COLUMN available_time_slots.teremszam IS 'Az időpont teremszáma';

COMMIT;



