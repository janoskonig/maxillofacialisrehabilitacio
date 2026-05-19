-- Research registry compliance Phase 1: CRF skeleton registry + quality state machine + recompute queue

-- ---------------------------------------------------------------------------
-- CRF registry (form/field versions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crf_form_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_code VARCHAR(64) NOT NULL,
  version_label VARCHAR(32) NOT NULL,
  lifecycle VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('draft', 'active', 'deprecated')),
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  deprecated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (form_code, version_label)
);

CREATE TABLE IF NOT EXISTS crf_field_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_version_id UUID NOT NULL REFERENCES crf_form_versions (id) ON DELETE CASCADE,
  field_code VARCHAR(64) NOT NULL,
  field_type VARCHAR(32) NOT NULL DEFAULT 'text',
  required_for_quality BOOLEAN NOT NULL DEFAULT false,
  required_for_ui BOOLEAN NOT NULL DEFAULT false,
  required_for_export BOOLEAN NOT NULL DEFAULT false,
  deprecated BOOLEAN NOT NULL DEFAULT false,
  compatibility_meta JSONB DEFAULT '{}'::jsonb,
  UNIQUE (form_version_id, field_code)
);

-- Seed minimal patient intake CRF skeleton
INSERT INTO crf_form_versions (form_code, version_label, lifecycle, schema_json)
SELECT 'patient_intake', 'v1', 'active', '{"description": "Core patient intake fields mapped to Patient type"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM crf_form_versions WHERE form_code = 'patient_intake' AND version_label = 'v1');

INSERT INTO crf_field_versions (form_version_id, field_code, field_type, required_for_quality, required_for_ui, required_for_export)
SELECT fv.id, f.field_code, 'text', true, true, true
FROM crf_form_versions fv
CROSS JOIN (VALUES
  ('nev'), ('taj'), ('szuletesiDatum'), ('nem'), ('email'),
  ('diagnozis'), ('kezelesreErkezesIndoka'), ('meglevoFogak')
) AS f(field_code)
WHERE fv.form_code = 'patient_intake' AND fv.version_label = 'v1'
ON CONFLICT (form_version_id, field_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Quality state machine
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_quality_state (
  entity_type VARCHAR(64) NOT NULL,
  entity_id UUID NOT NULL,
  quality_state VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
    CHECK (quality_state IN (
      'DRAFT', 'LOCAL_REVIEW', 'CENTER_APPROVED',
      'REGISTRY_APPROVED', 'LOCKED_FOR_ANALYSIS',
      'LEGACY_UNVERIFIED', 'IMPORTED_LEGACY'
    )),
  crf_form_version_id UUID REFERENCES crf_form_versions (id),
  completeness_score NUMERIC(5,2),
  missing_critical_fields JSONB DEFAULT '[]'::jsonb,
  contradiction_flags JSONB DEFAULT '[]'::jsonb,
  stale_days INT,
  source_revision BIGINT,
  computed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_quality_state_state
  ON entity_quality_state (quality_state, updated_at DESC);

-- Manual quality overrides (auditable)
CREATE TABLE IF NOT EXISTS quality_manual_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(64) NOT NULL,
  entity_id UUID NOT NULL,
  override_reason TEXT NOT NULL,
  override_actor VARCHAR(255) NOT NULL,
  override_expiry TIMESTAMPTZ,
  previous_state VARCHAR(32),
  new_state VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quality_manual_overrides_entity
  ON quality_manual_overrides (entity_type, entity_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Async quality recompute queue (dedupe: entity_id + target_revision + job_generation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quality_recompute_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(64) NOT NULL,
  entity_id UUID NOT NULL,
  target_revision BIGINT NOT NULL,
  job_generation BIGINT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'quarantined')),
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (entity_type, entity_id, target_revision, job_generation)
);

CREATE INDEX IF NOT EXISTS idx_quality_recompute_jobs_pending
  ON quality_recompute_jobs (status, enqueued_at)
  WHERE status = 'pending';
