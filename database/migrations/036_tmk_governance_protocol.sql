-- Research registry compliance Phase 3: governance, protocol metadata, consent lifecycle

-- ---------------------------------------------------------------------------
-- Study / center governance (MVP)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registry_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_code VARCHAR(64) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_center_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES registry_studies (id) ON DELETE CASCADE,
  center_code VARCHAR(64) NOT NULL,
  permission VARCHAR(32) NOT NULL
    CHECK (permission IN ('read', 'contribute', 'approve', 'export')),
  granted_by VARCHAR(255) NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  UNIQUE (study_id, center_code, permission)
);

CREATE TABLE IF NOT EXISTS analysis_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES registry_studies (id),
  requested_by VARCHAR(255) NOT NULL,
  purpose TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dataset_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID REFERENCES registry_studies (id),
  export_id UUID REFERENCES analysis_exports (id),
  snapshot_label VARCHAR(128) NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS publication_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID REFERENCES registry_studies (id),
  dataset_snapshot_id UUID REFERENCES dataset_snapshots (id),
  artifact_type VARCHAR(32) NOT NULL DEFAULT 'codebook',
  storage_uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Protocol metadata (lightweight, no runtime form engine)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registry_protocols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_code VARCHAR(64) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  version_label VARCHAR(32) NOT NULL,
  effective_from DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consent_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID REFERENCES registry_protocols (id),
  version_label VARCHAR(32) NOT NULL,
  consent_text_hash VARCHAR(128),
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ethics_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID NOT NULL REFERENCES registry_protocols (id),
  approval_number VARCHAR(64) NOT NULL,
  approved_at DATE NOT NULL,
  expires_at DATE,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS protocol_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID NOT NULL REFERENCES registry_protocols (id),
  amendment_label VARCHAR(64) NOT NULL,
  effective_from DATE NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Patient consent lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS consent_status VARCHAR(32) DEFAULT 'unknown'
    CHECK (consent_status IS NULL OR consent_status IN (
      'unknown', 'pending', 'granted', 'withdrawn', 'expired'
    )),
  ADD COLUMN IF NOT EXISTS consent_version_id UUID REFERENCES consent_versions (id),
  ADD COLUMN IF NOT EXISTS consent_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS research_usable_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS consent_export_manifest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  export_id UUID REFERENCES analysis_exports (id),
  consent_version_id UUID REFERENCES consent_versions (id),
  included_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  excluded_at TIMESTAMPTZ,
  exclusion_reason VARCHAR(64),
  UNIQUE (patient_id, export_id)
);

COMMENT ON TABLE consent_export_manifest IS
  'Tracks which frozen exports included a subject; supports withdrawal impact analysis. Legal policy for tombstone vs exclude-future-only is a compliance decision.';
