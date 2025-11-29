-- Migration: Google Calendar source and target calendar settings
-- Run with: psql -d <db> -f database/migration_google_calendar_calendars.sql

BEGIN;

-- Forrás naptár (honnan szedje ki a "szabad" eseményeket)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_calendar_source_calendar_id VARCHAR(255) DEFAULT 'primary';

-- Cél naptár (hova mentse az új eseményeket)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_calendar_target_calendar_id VARCHAR(255) DEFAULT 'primary';

-- Kommentek
COMMENT ON COLUMN users.google_calendar_source_calendar_id IS 'Google Calendar forrás naptár ID vagy név (honnan szedje ki a "szabad" eseményeket)';
COMMENT ON COLUMN users.google_calendar_target_calendar_id IS 'Google Calendar cél naptár ID vagy név (hova mentse az új eseményeket)';

COMMIT;





