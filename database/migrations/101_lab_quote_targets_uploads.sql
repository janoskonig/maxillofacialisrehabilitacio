BEGIN;

CREATE TABLE IF NOT EXISTS lab_quote_target_settings (
    target_id TEXT PRIMARY KEY CHECK (target_id IN ('fogtechnika', 'implantacio', 'neoss', 'straumann')),
    email VARCHAR(255),
    updated_by VARCHAR(255) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_quote_upload_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash CHAR(64) NOT NULL UNIQUE,
    quote_id UUID NOT NULL REFERENCES lab_quote_requests(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    target_id TEXT CHECK (target_id IN ('fogtechnika', 'implantacio', 'neoss', 'straumann')),
    recipient_email VARCHAR(255) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    upload_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_count BETWEEN 0 AND 20)
);
CREATE INDEX IF NOT EXISTS lab_quote_upload_links_quote_idx ON lab_quote_upload_links(quote_id);

ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS lab_quote_request_id UUID
    REFERENCES lab_quote_requests(id) ON DELETE SET NULL;
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS lab_quote_upload_link_id UUID
    REFERENCES lab_quote_upload_links(id) ON DELETE SET NULL;

COMMIT;
