-- Migration: Google Calendar event ID tárolása appointments táblában
-- Run with: psql -d <db> -f database/migration_appointments_google_calendar_event_id.sql

-- Google Calendar event ID tárolása az appointments táblához
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS google_calendar_event_id VARCHAR(255);

-- Index a gyors kereséshez
CREATE INDEX IF NOT EXISTS idx_appointments_google_calendar_event_id 
ON appointments(google_calendar_event_id) 
WHERE google_calendar_event_id IS NOT NULL;

-- Komment
COMMENT ON COLUMN appointments.google_calendar_event_id IS 'Google Calendar esemény ID (a Google Calendar API-ból kapott event ID)';

