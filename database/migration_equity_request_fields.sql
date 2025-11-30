-- Migration: Méltányossági kérelemhez szükséges mezők hozzáadása
-- Run with: psql -d <db> -f database/migration_equity_request_fields.sql

BEGIN;

-- Új mezők hozzáadása a patients táblához
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS kortorteneti_osszefoglalo TEXT,
ADD COLUMN IF NOT EXISTS kezelesi_terv_melleklet TEXT,
ADD COLUMN IF NOT EXISTS szakorvosi_velemeny TEXT;

-- Kommentek
COMMENT ON COLUMN patients.kortorteneti_osszefoglalo IS 'Kórtörténeti összefoglaló (3 hónapnál nem régebbi)';
COMMENT ON COLUMN patients.kezelesi_terv_melleklet IS 'Kezelési terv melléklet referencia (dokumentum ID vagy fájlnév)';
COMMENT ON COLUMN patients.szakorvosi_velemeny IS 'Szakorvosi vélemény az eszközrendelés szükségességéről (orvosszakmai indok)';

COMMIT;

