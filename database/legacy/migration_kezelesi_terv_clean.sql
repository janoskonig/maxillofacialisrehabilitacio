-- Migration: KEZELÉSI TERV oszlopok újraépítése az elejétől
-- Ez a script törli a régi oszlopokat (ha léteznek) és létrehozza az új JSONB oszlopokat
-- Run with: psql -d <db> -f database/migration_kezelesi_terv_clean.sql

BEGIN;

-- Töröljük a régi oszlopokat, ha léteznek (felső állcsont)
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso_new;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso_tervezett_atadas_datuma;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso_elkeszult;

-- Töröljük a régi oszlopokat, ha léteznek (alsó állcsont)
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also_new;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also_tervezett_atadas_datuma;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also_elkeszult;

-- Töröljük a régi indexeket
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_felso;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_felso_tervezett_atadas_datuma;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_felso_elkeszult;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_felso_gin;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_also;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_also_tervezett_atadas_datuma;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_also_elkeszult;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_also_gin;

-- Létrehozzuk az új JSONB oszlopokat (FELSŐ ÁLLCSONT)
-- Formátum: [{"tipus": "zárólemez", "tervezettAtadasDatuma": "2024-01-15", "elkeszult": false}, ...]
ALTER TABLE patients 
ADD COLUMN kezelesi_terv_felso JSONB NULL DEFAULT '[]'::jsonb;

-- Létrehozzuk az új JSONB oszlopokat (ALSÓ ÁLLCSONT)
-- Formátum: [{"tipus": "teljes lemezes fogpótlás", "tervezettAtadasDatuma": "2024-02-20", "elkeszult": true}, ...]
ALTER TABLE patients 
ADD COLUMN kezelesi_terv_also JSONB NULL DEFAULT '[]'::jsonb;

-- GIN indexek hozzáadása a gyors kereséshez (JSONB mezőkhöz)
CREATE INDEX idx_patients_kezelesi_terv_felso_gin ON patients USING GIN (kezelesi_terv_felso);
CREATE INDEX idx_patients_kezelesi_terv_also_gin ON patients USING GIN (kezelesi_terv_also);

-- Kommentek hozzáadása
COMMENT ON COLUMN patients.kezelesi_terv_felso IS 'Tervezett fogpótlások listája - felső állcsont (JSONB tömb: [{"tipus": "...", "tervezettAtadasDatuma": "...", "elkeszult": true/false}, ...])';
COMMENT ON COLUMN patients.kezelesi_terv_also IS 'Tervezett fogpótlások listája - alsó állcsont (JSONB tömb: [{"tipus": "...", "tervezettAtadasDatuma": "...", "elkeszult": true/false}, ...])';

COMMIT;

