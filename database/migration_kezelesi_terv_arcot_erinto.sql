-- Migration: KEZELÉSI TERV - ARCOT ÉRINTŐ REHABILITÁCIÓ mező hozzáadása
-- Run with: psql -d <db> -f database/migration_kezelesi_terv_arcot_erinto.sql

-- KEZELÉSI TERV - ARCOT ÉRINTŐ REHABILITÁCIÓ mező hozzáadása (JSONB tömb)
-- Formátum: [{"tipus": "orrepitézis", "elhorgonyzasEszkoze": "bőrragasztó", "tervezettAtadasDatuma": "2024-01-15", "elkeszult": false}, ...]
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS kezelesi_terv_arcot_erinto JSONB DEFAULT '[]'::jsonb;

-- Index hozzáadása a gyors kereséshez (GIN index JSONB mezőkhöz)
CREATE INDEX IF NOT EXISTS idx_patients_kezelesi_terv_arcot_erinto_gin ON patients USING GIN (kezelesi_terv_arcot_erinto);

-- Kommentek
COMMENT ON COLUMN patients.kezelesi_terv_arcot_erinto IS 'Tervezett arcot érintő rehabilitációk listája (JSONB tömb: [{"tipus": "...", "elhorgonyzasEszkoze": "...", "tervezettAtadasDatuma": "...", "elkeszult": true/false}, ...])';

