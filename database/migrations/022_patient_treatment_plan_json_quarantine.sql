-- Migration 022: JSON quarantine table (Phase 5 schema; additive, unused until resolver ships).
-- Immutable snapshots; source_fingerprint globally unique.

BEGIN;

CREATE TABLE IF NOT EXISTS patient_treatment_plan_json_quarantine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  location TEXT,
  payload_snapshot JSONB NOT NULL,
  source_fingerprint TEXT NOT NULL UNIQUE,
  resolver_version INT NOT NULL,
  resolution_status TEXT NOT NULL,
  resolved_episode_id UUID REFERENCES patient_episodes (id) ON DELETE SET NULL,
  resolved_plan_item_id UUID REFERENCES episode_plan_items (id) ON DELETE SET NULL,
  migration_run_id UUID REFERENCES migration_runs (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ptp_json_quarantine_patient
  ON patient_treatment_plan_json_quarantine (patient_id);

CREATE INDEX IF NOT EXISTS idx_ptp_json_quarantine_status
  ON patient_treatment_plan_json_quarantine (resolution_status);

COMMENT ON TABLE patient_treatment_plan_json_quarantine IS 'Quarantined patient treatment JSON; no auto-route to ambiguous open episodes.';

COMMIT;
