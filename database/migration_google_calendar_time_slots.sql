-- Migration: Google Calendar integration for time slots
-- Run with: psql -d <db> -f database/migration_google_calendar_time_slots.sql

BEGIN;

-- Add google_calendar_event_id column to track which Google Calendar event a time slot came from
ALTER TABLE available_time_slots 
ADD COLUMN IF NOT EXISTS google_calendar_event_id VARCHAR(255);

-- Add source column to track whether time slot was created manually or from Google Calendar
ALTER TABLE available_time_slots 
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual' CHECK (source IN ('manual', 'google_calendar'));

-- Index for fast lookup by Google Calendar event ID
CREATE INDEX IF NOT EXISTS idx_available_time_slots_google_calendar_event_id 
ON available_time_slots(google_calendar_event_id) 
WHERE google_calendar_event_id IS NOT NULL;

-- Comments
COMMENT ON COLUMN available_time_slots.google_calendar_event_id IS 'Google Calendar esemény ID (a Google Calendar API-ból kapott event ID)';
COMMENT ON COLUMN available_time_slots.source IS 'Az időpont forrása: manual (manuálisan létrehozva) vagy google_calendar (Google Calendar-ból szinkronizálva)';

COMMIT;




