-- Migration: Episode + Stage SSOT (Unified)
-- Adds: stage_suggestions, dismissed_stage_suggestions, episode_stage_suggestion_log,
--        stage_transition_rulesets, patient_intake_items, episode_steps,
--        patients.intake_status, patient_episodes.stage_version/snapshot_version
-- Idempotent: safe to run multiple times
-- Run with: psql -d <db> -f database/migration_episode_stage_ssot.sql

BEGIN;

-- =============================================================================
-- 1. stage_transition_rulesets (meta table for versioned rulesets)
-- Exactly one PUBLISHED at any time (partial unique index)
-- =============================================================================
CREATE TABLE IF NOT EXISTS stage_transition_rulesets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
    rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    valid_from TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    published_at TIMESTAMP WITH TIME ZONE,
    deprecated_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_transition_rulesets_published
    ON stage_transition_rulesets (status) WHERE status = 'PUBLISHED';

CREATE INDEX IF NOT EXISTS idx_stage_transition_rulesets_version
    ON stage_transition_rulesets (version DESC);

COMMENT ON TABLE stage_transition_rulesets IS 'Versioned stage transition rulesets. Exactly one PUBLISHED at any time.';

-- Seed initial PUBLISHED ruleset (v1) with default rules
INSERT INTO stage_transition_rulesets (version, status, rules, valid_from, created_by, published_at)
SELECT 1, 'PUBLISHED',
  '[
    {
      "id": "R001_first_consult_done",
      "from_stage": "STAGE_0",
      "to_stage": "STAGE_1",
      "description": "Első konzultáció megtörtént → Diagnosztika & dokumentáció",
      "conditions": ["has_completed_appointment_consult"]
    },
    {
      "id": "R002_plan_ready",
      "from_stage": "STAGE_1",
      "to_stage": "STAGE_2",
      "description": "Kezelési terv és árajánlat elkészült",
      "conditions": ["has_treatment_plan", "has_offer"]
    },
    {
      "id": "R003_plan_accepted",
      "from_stage": "STAGE_2",
      "to_stage": "STAGE_3",
      "description": "Terv elfogadva, finanszírozás egyeztetés",
      "conditions": ["offer_accepted"]
    },
    {
      "id": "R004_surgery_started",
      "from_stage": "STAGE_3",
      "to_stage": "STAGE_4",
      "description": "Sebészi fázis megkezdődött",
      "conditions": ["has_surgical_appointment_completed"]
    },
    {
      "id": "R005_prosthetic_started",
      "from_stage": "STAGE_4",
      "to_stage": "STAGE_5",
      "description": "Protetikai fázis megkezdődött",
      "conditions": ["has_prosthetic_appointment_started"]
    },
    {
      "id": "R005b_skip_surgery",
      "from_stage": "STAGE_3",
      "to_stage": "STAGE_5",
      "description": "Nincs sebészi fázis → egyenesen protetikai",
      "conditions": ["no_surgical_phase", "has_prosthetic_appointment_started"]
    },
    {
      "id": "R006_delivery_done",
      "from_stage": "STAGE_5",
      "to_stage": "STAGE_6",
      "description": "Átadás megtörtént",
      "conditions": ["has_delivery_completed"]
    },
    {
      "id": "R007_in_care",
      "from_stage": "STAGE_6",
      "to_stage": "STAGE_7",
      "description": "Gondozásba vétel",
      "conditions": ["delivery_older_than_30_days"]
    }
  ]'::jsonb,
  CURRENT_TIMESTAMP, 'system', CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM stage_transition_rulesets WHERE status = 'PUBLISHED'
);

-- =============================================================================
-- 2. patient_episodes: add stage_version + snapshot_version columns
-- =============================================================================
ALTER TABLE patient_episodes ADD COLUMN IF NOT EXISTS stage_version INT NOT NULL DEFAULT 0;
ALTER TABLE patient_episodes ADD COLUMN IF NOT EXISTS snapshot_version INT NOT NULL DEFAULT 0;

-- =============================================================================
-- 3. stage_suggestions (current suggestion per episode, UNIQUE(episode_id))
-- =============================================================================
CREATE TABLE IF NOT EXISTS stage_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    suggested_stage VARCHAR(50) NOT NULL,
    from_stage VARCHAR(50),
    ruleset_version INT NOT NULL,
    snapshot_version INT NOT NULL,
    dedupe_key VARCHAR(128) NOT NULL,
    rule_ids TEXT[] NOT NULL DEFAULT '{}',
    computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stage_suggestions_episode UNIQUE (episode_id)
);

CREATE INDEX IF NOT EXISTS idx_stage_suggestions_dedupe
    ON stage_suggestions (dedupe_key);

COMMENT ON TABLE stage_suggestions IS 'Current stage suggestion per episode. UPSERT semantics, max 1 row per episode.';

-- =============================================================================
-- 4. episode_stage_suggestion_log (append-only audit)
-- =============================================================================
CREATE TABLE IF NOT EXISTS episode_stage_suggestion_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    suggested_stage VARCHAR(50) NOT NULL,
    from_stage VARCHAR(50),
    ruleset_version INT NOT NULL,
    snapshot_version INT NOT NULL,
    dedupe_key VARCHAR(128) NOT NULL,
    rule_ids TEXT[] NOT NULL DEFAULT '{}',
    computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_stage_suggestion_log_episode
    ON episode_stage_suggestion_log (episode_id, computed_at DESC);

COMMENT ON TABLE episode_stage_suggestion_log IS 'Append-only audit log for all computed stage suggestions.';

-- =============================================================================
-- 5. dismissed_stage_suggestions (dismissed with TTL)
-- =============================================================================
CREATE TABLE IF NOT EXISTS dismissed_stage_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    dedupe_key VARCHAR(128) NOT NULL,
    dismissed_by VARCHAR(255) NOT NULL,
    dismissed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '14 days')
);

CREATE INDEX IF NOT EXISTS idx_dismissed_stage_suggestions_lookup
    ON dismissed_stage_suggestions (episode_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_dismissed_stage_suggestions_expiry
    ON dismissed_stage_suggestions (expires_at);

COMMENT ON TABLE dismissed_stage_suggestions IS 'Dismissed stage suggestions with TTL. Prevents re-showing same suggestion.';

-- =============================================================================
-- 6. patients.intake_status FSM
-- =============================================================================
ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_status VARCHAR(30)
    DEFAULT 'JUST_REGISTERED'
    CHECK (intake_status IN ('JUST_REGISTERED', 'NEEDS_TRIAGE', 'TRIAGED', 'IN_CARE'));

CREATE INDEX IF NOT EXISTS idx_patients_intake_status
    ON patients (intake_status);

-- =============================================================================
-- 7. patient_intake_items
-- =============================================================================
CREATE TABLE IF NOT EXISTS patient_intake_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    kind VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'CANCELLED')),
    source VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(255),
    notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_intake_items_unique_open
    ON patient_intake_items (patient_id, kind) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_patient_intake_items_patient
    ON patient_intake_items (patient_id, status);

COMMENT ON TABLE patient_intake_items IS 'Patient intake tracking items. UNIQUE(patient_id, kind) WHERE status=OPEN.';

-- =============================================================================
-- 8. episode_steps (concrete step instances from care_pathway)
-- =============================================================================
CREATE TABLE IF NOT EXISTS episode_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    step_code VARCHAR(80) NOT NULL,
    pathway_order_index INT NOT NULL,
    pool VARCHAR(20) NOT NULL DEFAULT 'work',
    duration_minutes INT NOT NULL DEFAULT 30,
    default_days_offset INT NOT NULL DEFAULT 7,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'skipped')),
    appointment_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_episode_steps_episode_order
    ON episode_steps (episode_id, pathway_order_index);

CREATE INDEX IF NOT EXISTS idx_episode_steps_status
    ON episode_steps (episode_id, status);

COMMENT ON TABLE episode_steps IS 'Concrete step instances generated from care_pathway for an episode. NEXT logic selects by pathway_order_index.';

-- =============================================================================
-- 9. intake_status_overrides (audit trail for admin overrides)
-- =============================================================================
CREATE TABLE IF NOT EXISTS intake_status_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    from_status VARCHAR(30) NOT NULL,
    to_status VARCHAR(30) NOT NULL,
    overridden_by VARCHAR(255) NOT NULL,
    overridden_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_intake_status_overrides_patient
    ON intake_status_overrides (patient_id, overridden_at DESC);

COMMIT;
