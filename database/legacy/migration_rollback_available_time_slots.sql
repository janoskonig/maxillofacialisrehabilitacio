-- Rollback migration: Visszavonja a feature/available-time-slots-booking branch változásait
-- Ez a migráció törli az available_time_slots táblát, az appointments táblát és az intezete oszlopot a users táblából
-- Run with: psql -d <db> -f database/migration_rollback_available_time_slots.sql

BEGIN;

-- 1. Töröljük az appointments táblát (ha létezik) - először töröljük, mert lehet, hogy foreign key kapcsolata van
DROP TABLE IF EXISTS appointments CASCADE;

-- 2. Töröljük az available_time_slots táblát (ha létezik)
DROP TABLE IF EXISTS available_time_slots CASCADE;

-- 3. Töröljük az intezete oszlopot a users táblából (ha létezik)
ALTER TABLE users 
DROP COLUMN IF EXISTS intezete;

-- 4. Töröljük a kapcsolódó indexeket (ha léteznek)
DROP INDEX IF EXISTS idx_users_intezete;
DROP INDEX IF EXISTS idx_available_time_slots_user_id;
DROP INDEX IF EXISTS idx_available_time_slots_start_time;
DROP INDEX IF EXISTS idx_appointments_patient_id;
DROP INDEX IF EXISTS idx_appointments_available_time_slot_id;
DROP INDEX IF EXISTS idx_appointments_status;
DROP INDEX IF EXISTS idx_appointments_created_at;

COMMIT;

-- Kommentek
COMMENT ON TABLE users IS 'Rendszer felhasználók - biztonságos hitelesítéshez (intezete oszlop eltávolítva)';

