-- Research registry compliance Phase 2: reproducible export, anonymization, lineage-lite

-- ---------------------------------------------------------------------------
-- Analysis exports (frozen research artifacts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analysis_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_label VARCHAR(128) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  query_definition JSONB NOT NULL,
  filter_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count INT,
  content_hash VARCHAR(128) NOT NULL,
  manifest_hash VARCHAR(128),
  checksum_hierarchy JSONB DEFAULT '{}'::jsonb,
  storage_uri TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'tombstoned')),
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analysis_exports_hash ON analysis_exports (content_hash);
CREATE INDEX IF NOT EXISTS idx_analysis_exports_created ON analysis_exports (created_at DESC);

-- Export subject membership (consent withdrawal tracking)
CREATE TABLE IF NOT EXISTS analysis_export_subjects (
  export_id UUID NOT NULL REFERENCES analysis_exports (id) ON DELETE CASCADE,
  patient_id UUID NOT NULL,
  anonymized_subject_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (export_id, patient_id)
);

-- ---------------------------------------------------------------------------
-- Algorithm registry + dataset derivation runs (lineage-lite)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS algorithm_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  algorithm_code VARCHAR(64) NOT NULL UNIQUE,
  version_label VARCHAR(32) NOT NULL,
  description TEXT,
  spec_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO algorithm_registry (algorithm_code, version_label, description, spec_json)
SELECT 'export_deterministic_hash', 'v1',
  'Canonical serialization for reproducible export hashes',
  '{"canonicalJson": true, "nullPolicy": "empty_string", "timezone": "UTC", "decimalPrecision": 10}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM algorithm_registry WHERE algorithm_code = 'export_deterministic_hash');

CREATE TABLE IF NOT EXISTS dataset_derivation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id UUID REFERENCES analysis_exports (id),
  algorithm_id UUID REFERENCES algorithm_registry (id),
  input_snapshot_refs JSONB DEFAULT '[]'::jsonb,
  output_hash VARCHAR(128),
  lineage_tier VARCHAR(20) NOT NULL DEFAULT 'hot'
    CHECK (lineage_tier IN ('hot', 'archived', 'legally_required')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Projection contract registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projection_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_name VARCHAR(80) NOT NULL,
  version_label VARCHAR(32) NOT NULL,
  source_json_paths TEXT[] NOT NULL,
  target_columns JSONB NOT NULL,
  deprecation_window_days INT DEFAULT 90,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (contract_name, version_label)
);

INSERT INTO projection_contracts (contract_name, version_label, source_json_paths, target_columns)
SELECT 'patient_implants_flat', 'v1',
  ARRAY['meglevo_implantatumok'],
  '{"implant_tooth": "text", "implant_detail": "text"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM projection_contracts WHERE contract_name = 'patient_implants_flat' AND version_label = 'v1'
);

-- Research patient view is a read model; materialized as view when base tables exist
CREATE OR REPLACE VIEW research_patient_view AS
SELECT
  p.id AS patient_id,
  CASE
    WHEN p.szuletesi_datum IS NOT NULL THEN
      (EXTRACT(YEAR FROM age(CURRENT_DATE, p.szuletesi_datum))::int / 5) * 5
    ELSE NULL
  END AS age_band_start,
  LEFT(COALESCE(p.iranyitoszam, ''), 2) AS region_prefix,
  p.nem,
  a.kezelesre_erkezes_indoka,
  p.domain_revision,
  p.legacy_compliance_status
FROM patients p
LEFT JOIN patient_anamnesis a ON a.patient_id = p.id;

COMMENT ON VIEW research_patient_view IS 'De-identified patient projection for research exports; no direct PHI fields.';
