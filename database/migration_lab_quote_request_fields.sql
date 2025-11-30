-- Migration: Árajánlatkérő mezők hozzáadása
-- Run with: psql -d <db> -f database/migration_lab_quote_request_fields.sql

BEGIN;

-- Új mezők hozzáadása a patients táblához
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS arajanlatkero_szoveg TEXT,
ADD COLUMN IF NOT EXISTS arajanlatkero_datuma DATE;

-- Kommentek
COMMENT ON COLUMN patients.arajanlatkero_szoveg IS 'Árajánlatkérő szabadszavas mező tartalma';
COMMENT ON COLUMN patients.arajanlatkero_datuma IS 'Árajánlatkérő dátuma (egy héttel az ajánlatkérés után)';

COMMIT;

