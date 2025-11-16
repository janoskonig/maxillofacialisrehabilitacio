-- Patient documents table for storing document metadata
-- Documents are stored on FTP server, metadata in PostgreSQL
-- Run with: psql -d <db> -f database/migration_patient_documents.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS patient_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    filename VARCHAR(500) NOT NULL,
    file_path VARCHAR(1000) NOT NULL, -- Path on FTP server
    file_size BIGINT NOT NULL, -- Size in bytes
    mime_type VARCHAR(255),
    description TEXT,
    tags JSONB DEFAULT '[]'::jsonb, -- Array of tags, e.g., ["orthopantomogram", "OP"]
    uploaded_by VARCHAR(255) NOT NULL, -- User email
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_documents_patient_id ON patient_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_documents_tags ON patient_documents USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_patient_documents_uploaded_at ON patient_documents(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_patient_documents_uploaded_by ON patient_documents(uploaded_by);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_patient_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_patient_documents_updated_at
    BEFORE UPDATE ON patient_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_patient_documents_updated_at();

-- Comments
COMMENT ON TABLE patient_documents IS 'Beteg dokumentumok metaadatai - a fájlok FTP szerveren tárolódnak';
COMMENT ON COLUMN patient_documents.file_path IS 'FTP szerveren lévő fájl elérési útja';
COMMENT ON COLUMN patient_documents.file_size IS 'Fájl mérete bájtban';
COMMENT ON COLUMN patient_documents.tags IS 'JSONB tömb címkékkel, pl. ["orthopantomogram", "OP"]';
COMMENT ON COLUMN patient_documents.uploaded_by IS 'Felhasználó email címe, aki feltöltötte';

