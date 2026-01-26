-- Migration: Patient stages timeline
-- This allows tracking patient stages in a timeline, with logical episodes for multiple treatment cycles
-- Run with: psql -d <db> -f database/migration_patient_stages.sql

BEGIN;

-- Create patient_stages table
CREATE TABLE IF NOT EXISTS patient_stages (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    episode_id UUID NOT NULL DEFAULT generate_uuid(),
    stage VARCHAR(50) NOT NULL CHECK (stage IN (
        'uj_beteg',
        'onkologiai_kezeles_kesz',
        'arajanlatra_var',
        'implantacios_sebeszi_tervezesre_var',
        'fogpotlasra_var',
        'fogpotlas_keszul',
        'fogpotlas_kesz',
        'gondozas_alatt'
    )),
    stage_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes TEXT, -- Opcionális megjegyzések a stádium változáshoz
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255), -- Email cím vagy 'system'
    
    -- Indexek
    CONSTRAINT idx_patient_stages_patient_date UNIQUE (patient_id, stage_date)
);

-- Indexek létrehozása
CREATE INDEX IF NOT EXISTS idx_patient_stages_patient_id ON patient_stages(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_stages_episode_id ON patient_stages(episode_id);
CREATE INDEX IF NOT EXISTS idx_patient_stages_stage_date ON patient_stages(stage_date DESC);
CREATE INDEX IF NOT EXISTS idx_patient_stages_current ON patient_stages(patient_id, stage_date DESC);

-- View a jelenlegi stádium lekérdezéséhez
CREATE OR REPLACE VIEW patient_current_stage AS
SELECT DISTINCT ON (patient_id)
    patient_id,
    episode_id,
    stage,
    stage_date,
    notes,
    created_at,
    created_by
FROM patient_stages
ORDER BY patient_id, stage_date DESC;

-- Kommentek
COMMENT ON TABLE patient_stages IS 'Betegstádiumok timeline - visszakövethető életút, logikai epizódokkal';
COMMENT ON COLUMN patient_stages.episode_id IS 'Logikai epizód azonosító - egy betegnek több kezelési ciklusa lehet (első rehabilitáció, második rehabilitáció, stb.). Minden új ciklus új episode_id-t kap.';
COMMENT ON COLUMN patient_stages.stage IS 'Stádium: uj_beteg, onkologiai_kezeles_kesz, arajanlatra_var, implantacios_sebeszi_tervezesre_var, fogpotlasra_var, fogpotlas_keszul, fogpotlas_kesz, gondozas_alatt';
COMMENT ON COLUMN patient_stages.stage_date IS 'A stádium változásának dátuma';
COMMENT ON COLUMN patient_stages.notes IS 'Opcionális megjegyzések a stádium változáshoz';
COMMENT ON COLUMN patient_stages.created_by IS 'Email cím vagy system - ki hozta létre a bejegyzést';

COMMIT;
