-- Migration: KEZELÉSI TERV mezők hozzáadása (felső és alsó állcsont külön, több tervezet lehet)
-- Run with: psql -d <db> -f database/migration_kezelesi_terv.sql

-- KEZELÉSI TERV - FELSŐ ÁLLCSONT mezők hozzáadása (JSONB tömb)
-- Formátum: [{"tipus": "zárólemez", "tervezettAtadasDatuma": "2024-01-15", "elkeszult": false}, ...]
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS kezelesi_terv_felso JSONB DEFAULT '[]'::jsonb;

-- KEZELÉSI TERV - ALSÓ ÁLLCSONT mezők hozzáadása (JSONB tömb)
-- Formátum: [{"tipus": "teljes lemezes fogpótlás", "tervezettAtadasDatuma": "2024-02-20", "elkeszult": true}, ...]
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS kezelesi_terv_also JSONB DEFAULT '[]'::jsonb;

-- Index hozzáadása a gyors kereséshez (GIN index JSONB mezőkhöz)
CREATE INDEX IF NOT EXISTS idx_patients_kezelesi_terv_felso_gin ON patients USING GIN (kezelesi_terv_felso);
CREATE INDEX IF NOT EXISTS idx_patients_kezelesi_terv_also_gin ON patients USING GIN (kezelesi_terv_also);

-- Kommentek
COMMENT ON COLUMN patients.kezelesi_terv_felso IS 'Tervezett fogpótlások listája - felső állcsont (JSONB tömb)';
COMMENT ON COLUMN patients.kezelesi_terv_also IS 'Tervezett fogpótlások listája - alsó állcsont (JSONB tömb)';

