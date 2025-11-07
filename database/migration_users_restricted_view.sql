-- Migration: RESTRICTED_VIEW mező hozzáadása a users táblához
-- Ez a mező meghatározza, hogy a felhasználó csak azokat a betegeket lássa,
-- akiknek van kitöltve az "Arcot érintő rehabilitáció" kezelési terv része
-- Run with: psql -d <db> -f database/migration_users_restricted_view.sql

-- RESTRICTED_VIEW mező hozzáadása
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS restricted_view BOOLEAN DEFAULT false;

-- Index hozzáadása (ha szükséges)
CREATE INDEX IF NOT EXISTS idx_users_restricted_view ON users(restricted_view) WHERE restricted_view = true;

-- Kommentek
COMMENT ON COLUMN users.restricted_view IS 'Ha true, akkor a felhasználó csak azokat a betegeket láthatja, akiknek van kitöltve az "Arcot érintő rehabilitáció" kezelési terv része';

