-- Migration: DOKTOR_NEVE oszlop hozzáadása a users táblához
-- Ez a mező tárolja a felhasználó nevét (kezelőorvos neve)
-- Run with: psql -d <db> -f database/migration_users_add_name.sql

-- Először töröljük a name oszlopot, ha létezik (régi verzió)
ALTER TABLE users 
DROP COLUMN IF EXISTS name;

-- DOKTOR_NEVE oszlop hozzáadása
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS doktor_neve VARCHAR(255);

-- Index hozzáadása a névhez (gyors kereséshez)
CREATE INDEX IF NOT EXISTS idx_users_doktor_neve ON users(doktor_neve);

-- Kommentek
COMMENT ON COLUMN users.doktor_neve IS 'Felhasználó neve (pl. Dr. Jász) - kezelőorvos neve a páciens űrlapon';

