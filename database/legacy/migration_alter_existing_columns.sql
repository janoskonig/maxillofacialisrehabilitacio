-- ALTER TABLE kódok a meglévő KEZELÉSI TERV oszlopok JSONB tömbbé alakításához
-- Ha már léteznek a kezelesi_terv_felso, kezelesi_terv_also oszlopok
-- Run with: psql -d <db> -f database/migration_alter_existing_columns.sql

-- FELSŐ ÁLLCSONT átalakítása
-- 1. Először töröljük az esetleg létező új oszlopot (ha újra fut a migráció)
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso_new;

-- 2. Hozzáadjuk az új JSONB oszlopot
ALTER TABLE patients 
ADD COLUMN kezelesi_terv_felso_new JSONB DEFAULT '[]'::jsonb;

-- 3. Migráljuk az adatokat a régi oszlopokból az új JSONB oszlopba
-- Megjegyzés: jsonb_build_array és jsonb_build_object használata NULL értékekkel is működik
UPDATE patients 
SET kezelesi_terv_felso_new = jsonb_build_array(
    jsonb_build_object(
        'tipus', COALESCE(NULLIF(TRIM(kezelesi_terv_felso), ''), '')::text,
        'tervezettAtadasDatuma', 
        CASE 
            WHEN kezelesi_terv_felso_tervezett_atadas_datuma IS NOT NULL 
            THEN to_char(kezelesi_terv_felso_tervezett_atadas_datuma, 'YYYY-MM-DD')
            ELSE NULL
        END,
        'elkeszult', COALESCE(kezelesi_terv_felso_elkeszult, false)
    )
)
WHERE (kezelesi_terv_felso IS NOT NULL AND TRIM(kezelesi_terv_felso) != '') OR
      kezelesi_terv_felso_tervezett_atadas_datuma IS NOT NULL OR
      kezelesi_terv_felso_elkeszult IS NOT NULL;

-- 4. Töröljük a régi oszlopokat
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso_tervezett_atadas_datuma;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso_elkeszult;

-- 5. Átnevezzük az új oszlopot
ALTER TABLE patients RENAME COLUMN kezelesi_terv_felso_new TO kezelesi_terv_felso;

-- ALSÓ ÁLLCSONT átalakítása
-- 1. Először töröljük az esetleg létező új oszlopot (ha újra fut a migráció)
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also_new;

-- 2. Hozzáadjuk az új JSONB oszlopot
ALTER TABLE patients 
ADD COLUMN kezelesi_terv_also_new JSONB DEFAULT '[]'::jsonb;

-- 3. Migráljuk az adatokat a régi oszlopokból az új JSONB oszlopba
UPDATE patients 
SET kezelesi_terv_also_new = jsonb_build_array(
    jsonb_build_object(
        'tipus', COALESCE(NULLIF(TRIM(kezelesi_terv_also), ''), '')::text,
        'tervezettAtadasDatuma', 
        CASE 
            WHEN kezelesi_terv_also_tervezett_atadas_datuma IS NOT NULL 
            THEN to_char(kezelesi_terv_also_tervezett_atadas_datuma, 'YYYY-MM-DD')
            ELSE NULL
        END,
        'elkeszult', COALESCE(kezelesi_terv_also_elkeszult, false)
    )
)
WHERE (kezelesi_terv_also IS NOT NULL AND TRIM(kezelesi_terv_also) != '') OR
      kezelesi_terv_also_tervezett_atadas_datuma IS NOT NULL OR
      kezelesi_terv_also_elkeszult IS NOT NULL;

-- 4. Töröljük a régi oszlopokat
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also_tervezett_atadas_datuma;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also_elkeszult;

-- 5. Átnevezzük az új oszlopot
ALTER TABLE patients RENAME COLUMN kezelesi_terv_also_new TO kezelesi_terv_also;

-- Indexek frissítése
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_felso;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_felso_tervezett_atadas_datuma;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_felso_elkeszult;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_also;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_also_tervezett_atadas_datuma;
DROP INDEX IF EXISTS idx_patients_kezelesi_terv_also_elkeszult;

CREATE INDEX IF NOT EXISTS idx_patients_kezelesi_terv_felso_gin ON patients USING GIN (kezelesi_terv_felso);
CREATE INDEX IF NOT EXISTS idx_patients_kezelesi_terv_also_gin ON patients USING GIN (kezelesi_terv_also);

-- Kommentek
COMMENT ON COLUMN patients.kezelesi_terv_felso IS 'Tervezett fogpótlások listája - felső állcsont (JSONB tömb: [{"tipus": "...", "tervezettAtadasDatuma": "...", "elkeszult": true/false}, ...])';
COMMENT ON COLUMN patients.kezelesi_terv_also IS 'Tervezett fogpótlások listája - alsó állcsont (JSONB tömb: [{"tipus": "...", "tervezettAtadasDatuma": "...", "elkeszult": true/false}, ...])';
