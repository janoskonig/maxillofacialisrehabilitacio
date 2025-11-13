-- Migration: epitéziskészítő szerepkör átnevezése technikus-ra
-- Run with: psql -d <db> -f database/migration_epitesziskeszito_to_technikus.sql

-- Először frissítjük a szerepköröket a users táblában
UPDATE users 
SET role = 'technikus' 
WHERE role = 'epitéziskészítő';

-- Frissítjük a role mező constraint-jét
ALTER TABLE users 
DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users 
ADD CONSTRAINT users_role_check 
CHECK (role IN ('admin', 'editor', 'viewer', 'fogpótlástanász', 'technikus', 'sebészorvos'));

-- Kommentek frissítése
COMMENT ON COLUMN users.role IS 'Felhasználó szerepköre: admin, editor, viewer, fogpótlástanász, technikus, vagy sebészorvos';



