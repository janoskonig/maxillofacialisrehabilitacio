-- Migration: KEZELÉSI TERV mezők átalakítása JSONB tömbbé
-- Ha már léteznek a régi oszlopok (VARCHAR, DATE, BOOLEAN), ezeket átalakítja JSONB tömbökké
-- Run with: psql -d <db> -f database/migration_kezelesi_terv_to_jsonb.sql

-- Először ellenőrizzük és alakítsuk át a felső állcsont adatokat
DO $$
BEGIN
    -- Ha létezik a régi kezelesi_terv_felso oszlop (VARCHAR), akkor alakítsuk át
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'patients' 
        AND column_name = 'kezelesi_terv_felso'
        AND data_type = 'character varying'
    ) THEN
        -- Időlegesen JSONB oszlopot hozunk létre
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesi_terv_felso_new JSONB DEFAULT '[]'::jsonb;
        
        -- Migráljuk az adatokat: ha van érték, akkor beletesszük egy tömbbe
        UPDATE patients 
        SET kezelesi_terv_felso_new = CASE
            WHEN kezelesi_terv_felso IS NOT NULL OR 
                 kezelesi_terv_felso_tervezett_atadas_datuma IS NOT NULL OR
                 kezelesi_terv_felso_elkeszult IS NOT NULL
            THEN jsonb_build_array(
                jsonb_build_object(
                    'tipus', COALESCE(kezelesi_terv_felso, ''),
                    'tervezettAtadasDatuma', 
                    CASE WHEN kezelesi_terv_felso_tervezett_atadas_datuma IS NOT NULL 
                         THEN kezelesi_terv_felso_tervezett_atadas_datuma::text 
                         ELSE NULL 
                    END,
                    'elkeszult', COALESCE(kezelesi_terv_felso_elkeszult, false)
                )
            )
            ELSE '[]'::jsonb
        END
        WHERE kezelesi_terv_felso IS NOT NULL 
           OR kezelesi_terv_felso_tervezett_atadas_datuma IS NOT NULL 
           OR kezelesi_terv_felso_elkeszult IS NOT NULL;
        
        -- Töröljük a régi oszlopokat
        ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso;
        ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso_tervezett_atadas_datuma;
        ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso_elkeszult;
        
        -- Átnevezzük az új oszlopot
        ALTER TABLE patients RENAME COLUMN kezelesi_terv_felso_new TO kezelesi_terv_felso;
    ELSE
        -- Ha nincs régi oszlop, akkor egyszerűen hozzuk létre az újat
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesi_terv_felso JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- Alsó állcsont esetében ugyanez
DO $$
BEGIN
    -- Ha létezik a régi kezelesi_terv_also oszlop (VARCHAR), akkor alakítsuk át
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'patients' 
        AND column_name = 'kezelesi_terv_also'
        AND data_type = 'character varying'
    ) THEN
        -- Időlegesen JSONB oszlopot hozunk létre
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesi_terv_also_new JSONB DEFAULT '[]'::jsonb;
        
        -- Migráljuk az adatokat: ha van érték, akkor beletesszük egy tömbbe
        UPDATE patients 
        SET kezelesi_terv_also_new = CASE
            WHEN kezelesi_terv_also IS NOT NULL OR 
                 kezelesi_terv_also_tervezett_atadas_datuma IS NOT NULL OR
                 kezelesi_terv_also_elkeszult IS NOT NULL
            THEN jsonb_build_array(
                jsonb_build_object(
                    'tipus', COALESCE(kezelesi_terv_also, ''),
                    'tervezettAtadasDatuma', 
                    CASE WHEN kezelesi_terv_also_tervezett_atadas_datuma IS NOT NULL 
                         THEN kezelesi_terv_also_tervezett_atadas_datuma::text 
                         ELSE NULL 
                    END,
                    'elkeszult', COALESCE(kezelesi_terv_also_elkeszult, false)
                )
            )
            ELSE '[]'::jsonb
        END
        WHERE kezelesi_terv_also IS NOT NULL 
           OR kezelesi_terv_also_tervezett_atadas_datuma IS NOT NULL 
           OR kezelesi_terv_also_elkeszult IS NOT NULL;
        
        -- Töröljük a régi oszlopokat
        ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also;
        ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also_tervezett_atadas_datuma;
        ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also_elkeszult;
        
        -- Átnevezzük az új oszlopot
        ALTER TABLE patients RENAME COLUMN kezelesi_terv_also_new TO kezelesi_terv_also;
    ELSE
        -- Ha nincs régi oszlop, akkor egyszerűen hozzuk létre az újat
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesi_terv_also JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- Index hozzáadása a gyors kereséshez (GIN index JSONB mezőkhöz)
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

