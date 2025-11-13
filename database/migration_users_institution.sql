-- Migration: Intézmény és hozzáférés indokolása mezők hozzáadása a users táblához
-- Run with: psql -d <db> -f database/migration_users_institution.sql

BEGIN;

-- INTÉZMÉNY oszlop hozzáadása
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS intezmeny VARCHAR(255);

-- HOZZAFERES_INDOKOLAS oszlop hozzáadása
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS hozzaferes_indokolas TEXT;

-- Index hozzáadása az intézményhez (gyors kereséshez)
CREATE INDEX IF NOT EXISTS idx_users_intezmeny ON users(intezmeny);

-- Kommentek
COMMENT ON COLUMN users.intezmeny IS 'Regisztráló intézménye (Arc-, Állcsont-, ...; Észak-Pesti Centrumkórház; OOI Fej-Nyaki...)';
COMMENT ON COLUMN users.hozzaferes_indokolas IS 'Rövid indokolás, miért kér hozzáférést a rendszerhez';

COMMIT;

