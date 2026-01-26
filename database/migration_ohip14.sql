-- Migration: OHIP-14 questionnaire responses
-- This allows tracking OHIP-14 questionnaire responses at different timepoints (T0, T1, T2)
-- Run with: psql -d <db> -f database/migration_ohip14.sql

BEGIN;

-- Create ohip14_responses table
CREATE TABLE IF NOT EXISTS ohip14_responses (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    episode_id UUID, -- NULL-able: lehet, hogy régi adatoknál nincs episode_id
    timepoint VARCHAR(2) NOT NULL CHECK (timepoint IN ('T0', 'T1', 'T2')),
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_by_patient BOOLEAN DEFAULT true,
    
    -- 14 kérdés válaszai (0-4 skála)
    q1_functional_limitation INTEGER CHECK (q1_functional_limitation >= 0 AND q1_functional_limitation <= 4),
    q2_functional_limitation INTEGER CHECK (q2_functional_limitation >= 0 AND q2_functional_limitation <= 4),
    q3_physical_pain INTEGER CHECK (q3_physical_pain >= 0 AND q3_physical_pain <= 4),
    q4_physical_pain INTEGER CHECK (q4_physical_pain >= 0 AND q4_physical_pain <= 4),
    q5_psychological_discomfort INTEGER CHECK (q5_psychological_discomfort >= 0 AND q5_psychological_discomfort <= 4),
    q6_psychological_discomfort INTEGER CHECK (q6_psychological_discomfort >= 0 AND q6_psychological_discomfort <= 4),
    q7_physical_disability INTEGER CHECK (q7_physical_disability >= 0 AND q7_physical_disability <= 4),
    q8_physical_disability INTEGER CHECK (q8_physical_disability >= 0 AND q8_physical_disability <= 4),
    q9_psychological_disability INTEGER CHECK (q9_psychological_disability >= 0 AND q9_psychological_disability <= 4),
    q10_psychological_disability INTEGER CHECK (q10_psychological_disability >= 0 AND q10_psychological_disability <= 4),
    q11_social_disability INTEGER CHECK (q11_social_disability >= 0 AND q11_social_disability <= 4),
    q12_social_disability INTEGER CHECK (q12_social_disability >= 0 AND q12_social_disability <= 4),
    q13_handicap INTEGER CHECK (q13_handicap >= 0 AND q13_handicap <= 4),
    q14_handicap INTEGER CHECK (q14_handicap >= 0 AND q14_handicap <= 4),
    
    -- Számított értékek
    total_score INTEGER, -- 0-56 (összes válasz összege)
    
    -- Dimenzió-szintű score-ok (klinikailag és kutatásilag fontos)
    functional_limitation_score INTEGER, -- Q1 + Q2 (0-8)
    physical_pain_score INTEGER, -- Q3 + Q4 (0-8)
    psychological_discomfort_score INTEGER, -- Q5 + Q6 (0-8)
    physical_disability_score INTEGER, -- Q7 + Q8 (0-8)
    psychological_disability_score INTEGER, -- Q9 + Q10 (0-8)
    social_disability_score INTEGER, -- Q11 + Q12 (0-8)
    handicap_score INTEGER, -- Q13 + Q14 (0-8)
    
    -- Metaadatok
    notes TEXT, -- Opcionális megjegyzések
    locked_at TIMESTAMP WITH TIME ZONE, -- Ha kitöltve, az orvos lezárhatja (későbbi feature)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255), -- Email vagy 'patient_portal'
    updated_by VARCHAR(255),
    
    -- UNIQUE constraint: egy beteg egy epizódon belül csak egyszer töltheti ki egy timepointot
    CONSTRAINT unique_patient_episode_timepoint UNIQUE (patient_id, episode_id, timepoint)
);

-- Indexek létrehozása
CREATE INDEX IF NOT EXISTS idx_ohip14_patient_episode_timepoint ON ohip14_responses(patient_id, episode_id, timepoint);
CREATE INDEX IF NOT EXISTS idx_ohip14_patient_id ON ohip14_responses(patient_id);
CREATE INDEX IF NOT EXISTS idx_ohip14_episode_id ON ohip14_responses(episode_id) WHERE episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ohip14_timepoint ON ohip14_responses(timepoint);
CREATE INDEX IF NOT EXISTS idx_ohip14_completed_at ON ohip14_responses(completed_at DESC);

-- Trigger a frissítés dátumának automatikus frissítéséhez
CREATE OR REPLACE FUNCTION update_ohip14_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_ohip14_responses_updated_at 
    BEFORE UPDATE ON ohip14_responses 
    FOR EACH ROW 
    EXECUTE FUNCTION update_ohip14_updated_at();

-- Kommentek
COMMENT ON TABLE ohip14_responses IS 'OHIP-14 kérdőív válaszok - longitudinális outcome mérés';
COMMENT ON COLUMN ohip14_responses.episode_id IS 'Logikai epizód azonosító - összekapcsolható a patient_stages.episode_id-vel. NULL lehet régi adatoknál.';
COMMENT ON COLUMN ohip14_responses.timepoint IS 'Timepoint: T0 (kezelés előtt), T1 (rehabilitáció előtt), T2 (rehabilitáció után)';
COMMENT ON COLUMN ohip14_responses.completed_by_patient IS 'Igaz, ha a beteg töltötte ki, hamis ha orvos/admin';
COMMENT ON COLUMN ohip14_responses.locked_at IS 'Ha kitöltve, az orvos lezárhatja, ekkor a beteg nem módosíthatja (későbbi feature)';
COMMENT ON COLUMN ohip14_responses.total_score IS 'Összpontszám: 0-56 (összes válasz összege)';
COMMENT ON COLUMN ohip14_responses.functional_limitation_score IS 'Funkcionális korlátozás dimenzió score (Q1 + Q2, 0-8)';
COMMENT ON COLUMN ohip14_responses.physical_pain_score IS 'Fizikai fájdalom dimenzió score (Q3 + Q4, 0-8)';
COMMENT ON COLUMN ohip14_responses.psychological_discomfort_score IS 'Pszichológiai kellemetlenség dimenzió score (Q5 + Q6, 0-8)';
COMMENT ON COLUMN ohip14_responses.physical_disability_score IS 'Fizikai fogyatékosság dimenzió score (Q7 + Q8, 0-8)';
COMMENT ON COLUMN ohip14_responses.psychological_disability_score IS 'Pszichológiai fogyatékosság dimenzió score (Q9 + Q10, 0-8)';
COMMENT ON COLUMN ohip14_responses.social_disability_score IS 'Társasági fogyatékosság dimenzió score (Q11 + Q12, 0-8)';
COMMENT ON COLUMN ohip14_responses.handicap_score IS 'Hátrány dimenzió score (Q13 + Q14, 0-8)';

COMMIT;
