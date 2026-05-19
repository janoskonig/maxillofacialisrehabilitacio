-- Research registry compliance Phase 0: domain foundation
-- Unified audit, entity revision, temporal columns, dependency graph, feature flags

-- ---------------------------------------------------------------------------
-- Feature flags (gradual rollout)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_feature_flags (
  key VARCHAR(80) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO compliance_feature_flags (key, enabled, description) VALUES
  ('unified_audit_events', false, 'Write critical transitions to audit_events'),
  ('entity_revision_locking', false, 'Optimistic locking via domain_revision on writes'),
  ('quality_recompute_queue', false, 'Enqueue async quality recompute jobs'),
  ('research_export_pipeline', false, 'Use analysis_exports instead of live CSV for research'),
  ('tighten_snapshot_changes_access', false, 'Restrict changes/snapshots to clinical roles')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Unified append-only audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(64) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_id VARCHAR(255),
  actor_email VARCHAR(255),
  reason TEXT,
  old_state JSONB,
  new_state JSONB,
  correlation_id VARCHAR(64),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON audit_events (entity_type, entity_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON audit_events (action, recorded_at DESC);

COMMENT ON TABLE audit_events IS 'Append-only unified audit bus (distinct from lineage and patient_snapshots).';

-- ---------------------------------------------------------------------------
-- Entity revision + temporal columns on critical aggregates
-- ---------------------------------------------------------------------------
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS domain_revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legacy_compliance_status VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNVERIFIED';

ALTER TABLE patient_episodes
  ADD COLUMN IF NOT EXISTS domain_revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS domain_revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ;

-- approved_at may already exist from legacy migration
COMMENT ON COLUMN patients.domain_revision IS 'Optimistic locking revision; incremented on clinical writes.';
COMMENT ON COLUMN patients.legacy_compliance_status IS 'LEGACY_UNVERIFIED | IMPORTED_LEGACY | VERIFIED — transitional backfill states.';

-- ---------------------------------------------------------------------------
-- Versioned dependency graph (DAG, no cycles enforced in app layer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dependency_graph_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_label VARCHAR(64) NOT NULL UNIQUE,
  graph_json JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entity_invalidation_state (
  entity_type VARCHAR(64) NOT NULL,
  entity_id UUID NOT NULL,
  graph_version_id UUID REFERENCES dependency_graph_versions (id),
  dirty_reason VARCHAR(128),
  dirty_since TIMESTAMPTZ,
  last_recomputed_at TIMESTAMPTZ,
  target_revision BIGINT,
  PRIMARY KEY (entity_type, entity_id)
);

-- Seed v1 graph (patient -> episode -> quality/export downstream)
INSERT INTO dependency_graph_versions (version_label, graph_json, is_active)
SELECT 'v1_initial', '{
  "nodes": ["patient", "episode", "appointment", "ohip14_response", "entity_quality_state", "analysis_export"],
  "edges": [
    {"from": "patient", "to": "episode", "scope": "aggregate_local"},
    {"from": "episode", "to": "appointment", "scope": "aggregate_local"},
    {"from": "patient", "to": "entity_quality_state", "scope": "materialized"},
    {"from": "entity_quality_state", "to": "analysis_export", "scope": "materialized"}
  ]
}'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM dependency_graph_versions WHERE version_label = 'v1_initial');

-- ---------------------------------------------------------------------------
-- Read-model marker (research/quality projections are not authoritative)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS read_model_registry (
  model_name VARCHAR(80) PRIMARY KEY,
  source_entities TEXT[] NOT NULL,
  authoritative_write_blocked BOOLEAN NOT NULL DEFAULT true,
  rebuild_strategy VARCHAR(32) NOT NULL DEFAULT 'async_queue',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO read_model_registry (model_name, source_entities, authoritative_write_blocked, rebuild_strategy) VALUES
  ('entity_quality_state', ARRAY['patient', 'episode', 'ohip14_response'], true, 'async_queue'),
  ('research_patient_view', ARRAY['patient'], true, 'full_rebuild'),
  ('analysis_exports', ARRAY['entity_quality_state', 'patient'], true, 'immutable_artifact')
ON CONFLICT (model_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Source-of-truth registry (DB mirror; canonical definitions also in TS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_source_registry (
  entity_name VARCHAR(64) NOT NULL,
  field_path VARCHAR(128) NOT NULL DEFAULT '*',
  authoritative_source VARCHAR(32) NOT NULL,
  recomputable BOOLEAN NOT NULL DEFAULT false,
  is_cache BOOLEAN NOT NULL DEFAULT false,
  immutable BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  PRIMARY KEY (entity_name, field_path)
);

INSERT INTO domain_source_registry (entity_name, field_path, authoritative_source, recomputable, is_cache, immutable, notes) VALUES
  ('patient', '*', 'clinical_write', false, false, false, 'Core patient demographics and clinical fields'),
  ('ohip14_responses', 'answers', 'clinical_write', false, false, false, 'Raw OHIP-14 answers'),
  ('ohip14_responses', 'summary', 'derived', true, false, false, 'Computed from answers'),
  ('entity_quality_state', '*', 'quality_engine', true, true, false, 'Materialized quality; recomputable from CRF + rules'),
  ('episode_forecast_cache', '*', 'derived', true, true, false, 'Scheduling forecast cache'),
  ('analysis_exports', '*', 'frozen_artifact', false, false, true, 'Immutable research export artifacts'),
  ('patient_snapshots', '*', 'snapshot', false, false, true, 'Point-in-time clinical snapshot; not lineage'),
  ('audit_events', '*', 'audit_bus', false, false, true, 'Append-only audit trail')
ON CONFLICT (entity_name, field_path) DO NOTHING;
