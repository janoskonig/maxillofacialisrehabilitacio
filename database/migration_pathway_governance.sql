-- Migration: Pathway governance — owner, change log, override rate
-- Run with: psql -d <db> -f database/migration_pathway_governance.sql
-- Implements: care_pathways.owner_id, care_pathway_change_events.change_details, degraded flag support

BEGIN;

-- =============================================================================
-- 1. care_pathways: add owner_id (pathway owner for governance)
-- =============================================================================
ALTER TABLE care_pathways ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_care_pathways_owner ON care_pathways(owner_id);

COMMENT ON COLUMN care_pathways.owner_id IS 'Pathway owner responsible for monthly review and governance.';

-- =============================================================================
-- 2. care_pathway_change_events: add change_details for richer change log
-- =============================================================================
ALTER TABLE care_pathway_change_events ADD COLUMN IF NOT EXISTS change_details JSONB;

COMMENT ON COLUMN care_pathway_change_events.change_details IS 'Structured change: {field, old_value, new_value, steps_json_diff?}.';

COMMIT;
