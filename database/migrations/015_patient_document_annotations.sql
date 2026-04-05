BEGIN;

CREATE TABLE IF NOT EXISTS patient_document_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES patient_documents(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('freehand', 'text')),
  payload JSONB NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  deleted_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_patient_doc_ann_document_active
  ON patient_document_annotations (document_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_doc_ann_patient_document
  ON patient_document_annotations (patient_id, document_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION update_patient_document_annotations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_patient_document_annotations_updated_at ON patient_document_annotations;
CREATE TRIGGER trg_patient_document_annotations_updated_at
  BEFORE UPDATE ON patient_document_annotations
  FOR EACH ROW
  EXECUTE FUNCTION update_patient_document_annotations_updated_at();

COMMENT ON TABLE patient_document_annotations IS 'Nem destruktív képannotációk (szabadkézi, szöveg); eredeti fájl az FTP-n változatlan';

COMMIT;
