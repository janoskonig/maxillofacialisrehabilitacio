-- Migration: Árajánlatkérő tábla létrehozása
-- Run with: psql -d <db> -f database/migration_lab_quote_requests_table.sql

BEGIN;

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Árajánlatkérő tábla létrehozása
CREATE TABLE IF NOT EXISTS lab_quote_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    szoveg TEXT NOT NULL,
    datuma DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) NOT NULL,
    updated_by VARCHAR(255) NOT NULL
);

-- Indexek a teljesítményhez
CREATE INDEX IF NOT EXISTS idx_lab_quote_requests_patient_id ON lab_quote_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_quote_requests_datuma ON lab_quote_requests(datuma);
CREATE INDEX IF NOT EXISTS idx_lab_quote_requests_created_at ON lab_quote_requests(created_at);

-- Trigger az updated_at automatikus frissítéséhez
CREATE OR REPLACE FUNCTION update_lab_quote_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_lab_quote_requests_updated_at
    BEFORE UPDATE ON lab_quote_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_lab_quote_requests_updated_at();

-- Kommentek
COMMENT ON TABLE lab_quote_requests IS 'Árajánlatkérők a laborba';
COMMENT ON COLUMN lab_quote_requests.patient_id IS 'Beteg ID (foreign key)';
COMMENT ON COLUMN lab_quote_requests.szoveg IS 'Árajánlatkérő szabadszavas mező tartalma';
COMMENT ON COLUMN lab_quote_requests.datuma IS 'Árajánlatkérő dátuma (egy héttel az ajánlatkérés után)';
COMMENT ON COLUMN lab_quote_requests.created_by IS 'Felhasználó email címe, aki létrehozta';
COMMENT ON COLUMN lab_quote_requests.updated_by IS 'Felhasználó email címe, aki utoljára módosította';

COMMIT;

