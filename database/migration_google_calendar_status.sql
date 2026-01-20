-- Migration: Google Calendar státusz mezők hozzáadása
-- Run with: psql -d <db> -f database/migration_google_calendar_status.sql

-- Google Calendar státusz és error tracking mezők
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_calendar_status VARCHAR(50) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS google_calendar_last_error_code VARCHAR(100),
ADD COLUMN IF NOT EXISTS google_calendar_last_error_at TIMESTAMP WITH TIME ZONE;

-- Opcionális: token_version optimistic concurrency-hez (ha szükséges)
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_token_version INTEGER DEFAULT 0;

-- Kommentek
COMMENT ON COLUMN users.google_calendar_status IS 'Google Calendar kapcsolat státusza: active, reconnect_required, broken_config';
COMMENT ON COLUMN users.google_calendar_last_error_code IS 'Utolsó hiba kódja (pl. invalid_grant, insufficientPermissions, rateLimitExceeded)';
COMMENT ON COLUMN users.google_calendar_last_error_at IS 'Utolsó hiba időpontja';

-- Index a státusz alapján történő lekérdezésekhez
CREATE INDEX IF NOT EXISTS idx_users_google_calendar_status 
ON users(google_calendar_status) 
WHERE google_calendar_enabled = true;

-- Meglévő rekordok státusza aktívra állítása
UPDATE users 
SET google_calendar_status = 'active'
WHERE google_calendar_enabled = true 
  AND google_calendar_status IS NULL;
