-- Migration: Google Calendar OAuth2 tokenek tárolása
-- Run with: psql -d <db> -f database/migration_google_calendar_tokens.sql

-- Google Calendar OAuth2 tokenek tárolása a users táblához
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_calendar_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_calendar_access_token TEXT,
ADD COLUMN IF NOT EXISTS google_calendar_token_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS google_calendar_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS google_calendar_email VARCHAR(255);

-- Kommentek
COMMENT ON COLUMN users.google_calendar_refresh_token IS 'Google OAuth2 refresh token (titkosítva tárolva)';
COMMENT ON COLUMN users.google_calendar_access_token IS 'Google OAuth2 access token (titkosítva tárolva, ideiglenes)';
COMMENT ON COLUMN users.google_calendar_token_expires_at IS 'Access token lejárat ideje';
COMMENT ON COLUMN users.google_calendar_enabled IS 'Google Calendar integráció engedélyezve van-e';
COMMENT ON COLUMN users.google_calendar_email IS 'Google fiók email címe';

