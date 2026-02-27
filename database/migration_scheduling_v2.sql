-- Migration: Treatment Scheduling Optimization v2
-- Run with: psql -d <db> -f database/migration_scheduling_v2.sql
-- Implements: WIP control, one-hard-next, slot intents, capacity pools, episode blocks, next-step cache

BEGIN;

-- =============================================================================
-- 1. care_pathways (pathway templates with step definitions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS care_pathways (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    reason VARCHAR(100) CHECK (reason IN ('traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot')),
    steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    version INT NOT NULL DEFAULT 1,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_care_pathways_reason ON care_pathways(reason);
COMMENT ON TABLE care_pathways IS 'Kezelési utak sablonok steps_json: [{step_code, pool, duration_minutes, default_days_offset, requires_precommit?}]';

-- =============================================================================
-- 2. patient_episodes: add care_pathway_id, care_pathway_version, assigned_provider_id
-- =============================================================================
ALTER TABLE patient_episodes ADD COLUMN IF NOT EXISTS care_pathway_id UUID REFERENCES care_pathways(id);
ALTER TABLE patient_episodes ADD COLUMN IF NOT EXISTS care_pathway_version INT;
ALTER TABLE patient_episodes ADD COLUMN IF NOT EXISTS assigned_provider_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_patient_episodes_care_pathway ON patient_episodes(care_pathway_id);
CREATE INDEX IF NOT EXISTS idx_patient_episodes_assigned_provider ON patient_episodes(assigned_provider_id);

-- =============================================================================
-- 3. appointments: add scheduling v2 columns
-- =============================================================================
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS episode_id UUID REFERENCES patient_episodes(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 30;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pool VARCHAR(16) NOT NULL DEFAULT 'work' CHECK (pool IN ('consult', 'work', 'control'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS no_show_risk NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (no_show_risk >= 0 AND no_show_risk <= 1);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS requires_confirmation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_via VARCHAR(30) NOT NULL DEFAULT 'migration' CHECK (created_via IN ('worklist', 'patient_self', 'admin_override', 'surgeon_override', 'migration', 'google_import'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS requires_precommit BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_appointments_episode_id ON appointments(episode_id) WHERE episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_pool ON appointments(pool);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time) WHERE start_time IS NOT NULL;

-- Backfill start_time/end_time from available_time_slots for existing appointments
UPDATE appointments a
SET start_time = ats.start_time,
    end_time = ats.start_time + (COALESCE(a.duration_minutes, 30) || ' minutes')::interval
FROM available_time_slots ats
WHERE a.time_slot_id = ats.id AND (a.start_time IS NULL OR a.end_time IS NULL);

-- Trigger to keep start_time/end_time in sync when time_slot changes
CREATE OR REPLACE FUNCTION appointments_sync_times_from_slot()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.time_slot_id IS DISTINCT FROM OLD.time_slot_id THEN
        SELECT ats.start_time, ats.start_time + (COALESCE(NEW.duration_minutes, 30) || ' minutes')::interval
        INTO NEW.start_time, NEW.end_time
        FROM available_time_slots ats WHERE ats.id = NEW.time_slot_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appointments_1_sync_times ON appointments;
CREATE TRIGGER trg_appointments_1_sync_times
    BEFORE INSERT OR UPDATE OF time_slot_id, duration_minutes ON appointments
    FOR EACH ROW EXECUTE FUNCTION appointments_sync_times_from_slot();

-- Materialized is_future, is_active_status for one-hard-next (maintained by trigger)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_future BOOLEAN DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_active_status BOOLEAN DEFAULT true;

CREATE OR REPLACE FUNCTION appointments_set_is_future_active()
RETURNS TRIGGER AS $$
BEGIN
    NEW.is_future := (NEW.start_time IS NOT NULL AND NEW.start_time > CURRENT_TIMESTAMP);
    NEW.is_active_status := (NEW.appointment_status IS NULL OR NEW.appointment_status = 'completed');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Runs after sync (alphabetically 2 > 1)
DROP TRIGGER IF EXISTS trg_appointments_2_is_future ON appointments;
CREATE TRIGGER trg_appointments_2_is_future
    BEFORE INSERT OR UPDATE OF start_time, appointment_status, time_slot_id ON appointments
    FOR EACH ROW EXECUTE FUNCTION appointments_set_is_future_active();

-- Backfill is_future, is_active_status for existing rows
UPDATE appointments SET
    is_future = (start_time IS NOT NULL AND start_time > CURRENT_TIMESTAMP),
    is_active_status = (appointment_status IS NULL OR appointment_status = 'completed');

-- Partial unique index: one-hard-next - at most 1 future work appt per episode (unless requires_precommit)
DROP INDEX IF EXISTS idx_appointments_one_hard_next;
CREATE UNIQUE INDEX idx_appointments_one_hard_next ON appointments(episode_id)
    WHERE episode_id IS NOT NULL AND pool = 'work' AND is_future = true AND is_active_status = true AND requires_precommit = false;

-- =============================================================================
-- 4. available_time_slots: add slot_purpose, state (slot state machine)
-- =============================================================================
ALTER TABLE available_time_slots ADD COLUMN IF NOT EXISTS slot_purpose VARCHAR(16) CHECK (slot_purpose IN ('consult', 'work', 'control', 'flexible'));
ALTER TABLE available_time_slots ADD COLUMN IF NOT EXISTS state VARCHAR(16) NOT NULL DEFAULT 'free' CHECK (state IN ('free', 'offered', 'held', 'booked', 'blocked'));
ALTER TABLE available_time_slots ADD COLUMN IF NOT EXISTS duration_minutes INT DEFAULT 30;

-- Backfill state from status
UPDATE available_time_slots SET state = CASE WHEN status = 'booked' THEN 'booked' ELSE 'free' END;

CREATE INDEX IF NOT EXISTS idx_available_time_slots_slot_purpose ON available_time_slots(slot_purpose) WHERE slot_purpose IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_available_time_slots_state ON available_time_slots(state);

-- =============================================================================
-- 5. slot_intents (soft planning - no capacity consumed)
-- =============================================================================
CREATE TABLE IF NOT EXISTS slot_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    step_code VARCHAR(50) NOT NULL,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    duration_minutes INT NOT NULL,
    pool VARCHAR(16) NOT NULL CHECK (pool IN ('consult', 'work', 'control')),
    state VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'converted', 'cancelled', 'expired')),
    priority INT DEFAULT 0,
    suggested_start TIMESTAMPTZ,
    suggested_end TIMESTAMPTZ,
    slot_hold_expires_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_slot_intents_episode_state ON slot_intents(episode_id, state);
CREATE INDEX IF NOT EXISTS idx_slot_intents_pool_window ON slot_intents(pool, window_start) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS idx_slot_intents_priority_window ON slot_intents(priority, window_start) WHERE state = 'open';

-- =============================================================================
-- 6. capacity_pool_config (weekly quotas)
-- =============================================================================
CREATE TABLE IF NOT EXISTS capacity_pool_config (
    week_start DATE NOT NULL PRIMARY KEY,
    consult_min INT NOT NULL DEFAULT 2,
    consult_target INT NOT NULL DEFAULT 4,
    work_target INT NOT NULL DEFAULT 20,
    control_target INT NOT NULL DEFAULT 6,
    flex_target INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 7. scheduling_override_audit
-- =============================================================================
CREATE TABLE IF NOT EXISTS scheduling_override_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    override_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduling_override_audit_episode ON scheduling_override_audit(episode_id);

-- =============================================================================
-- 8. episode_next_step_cache (authoritative for worklist/dashboards)
-- =============================================================================
CREATE TABLE IF NOT EXISTS episode_next_step_cache (
    episode_id UUID PRIMARY KEY REFERENCES patient_episodes(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES users(id),
    pool VARCHAR(16) NOT NULL CHECK (pool IN ('consult', 'work', 'control')),
    duration_minutes INT NOT NULL,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    step_code VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'blocked')),
    blocked_reason TEXT,
    overdue_days INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_next_step_cache_provider ON episode_next_step_cache(provider_id);
CREATE INDEX IF NOT EXISTS idx_episode_next_step_cache_pool ON episode_next_step_cache(pool);

-- =============================================================================
-- 9. episode_blocks (clinical blockers - BLOCKED state)
-- =============================================================================
CREATE TABLE IF NOT EXISTS episode_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    key VARCHAR(80) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ NOT NULL,
    renewal_count INT NOT NULL DEFAULT 0,
    expected_unblock_date TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_blocks_episode_active ON episode_blocks(episode_id, active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_episode_blocks_expires ON episode_blocks(expires_at) WHERE active = true;

-- =============================================================================
-- 10. slot_purpose_events (audit retagging)
-- =============================================================================
CREATE TABLE IF NOT EXISTS slot_purpose_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES available_time_slots(id) ON DELETE CASCADE,
    old_purpose VARCHAR(16),
    new_purpose VARCHAR(16) NOT NULL,
    reason TEXT,
    job_run_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_slot_purpose_events_slot ON slot_purpose_events(slot_id);

-- =============================================================================
-- 11. appointment_status_events (immutable event log)
-- =============================================================================
CREATE TABLE IF NOT EXISTS appointment_status_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    old_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_appointment_status_events_appointment ON appointment_status_events(appointment_id);

-- =============================================================================
-- 12. episode_care_team (team-based attribution)
-- =============================================================================
CREATE TABLE IF NOT EXISTS episode_care_team (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(episode_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_care_team_one_primary ON episode_care_team(episode_id) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS idx_episode_care_team_user ON episode_care_team(user_id);

-- =============================================================================
-- 13. doctor_capacity_overrides (vacation, sick, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS doctor_capacity_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    date DATE NOT NULL,
    multiplier NUMERIC(3,2) NOT NULL CHECK (multiplier >= 0 AND multiplier <= 1),
    reason TEXT,
    UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_doctor_capacity_overrides_user_date ON doctor_capacity_overrides(user_id, date);

-- =============================================================================
-- 14. scheduling_slas + sla_violations
-- =============================================================================
CREATE TABLE IF NOT EXISTS scheduling_slas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    applies_to VARCHAR(50),
    max_days_without_hard_next INT NOT NULL,
    max_overdue_days INT NOT NULL,
    escalation_rule TEXT
);

CREATE TABLE IF NOT EXISTS sla_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sla_id UUID NOT NULL REFERENCES scheduling_slas(id),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    violated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    overdue_by_days INT,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sla_violations_episode ON sla_violations(episode_id);
CREATE INDEX IF NOT EXISTS idx_sla_violations_resolved ON sla_violations(resolved_at) WHERE resolved_at IS NULL;

-- =============================================================================
-- 15. care_pathway_change_events (pathway governance)
-- =============================================================================
CREATE TABLE IF NOT EXISTS care_pathway_change_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id UUID NOT NULL REFERENCES care_pathways(id) ON DELETE CASCADE,
    changed_by VARCHAR(255),
    change_type VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 16. lab_queue_metrics (multi-resource bottleneck)
-- =============================================================================
CREATE TABLE IF NOT EXISTS lab_queue_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    wip_count INT NOT NULL,
    expected_lead_time_days INT,
    note TEXT
);

-- =============================================================================
-- 17. scheduling_events (outbox for cache refresh)
-- =============================================================================
CREATE TABLE IF NOT EXISTS scheduling_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scheduling_events_unprocessed ON scheduling_events(created_at) WHERE processed_at IS NULL;

-- =============================================================================
-- 18. episode_tasks (BLOCKED exit ramp)
-- =============================================================================
CREATE TABLE IF NOT EXISTS episode_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_tasks_episode ON episode_tasks(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_tasks_due ON episode_tasks(due_at) WHERE completed_at IS NULL;

-- =============================================================================
-- Seed: default care pathway for onkológiai kezelés utáni állapot
-- =============================================================================
INSERT INTO care_pathways (name, reason, steps_json, version, priority)
SELECT 'Onkológiai kezelés utáni rehabilitáció', 'onkológiai kezelés utáni állapot',
'[
  {"step_code": "consult_1", "pool": "consult", "duration_minutes": 30, "default_days_offset": 0},
  {"step_code": "diagnostic", "pool": "work", "duration_minutes": 45, "default_days_offset": 14},
  {"step_code": "impression_1", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
  {"step_code": "try_in_1", "pool": "work", "duration_minutes": 30, "default_days_offset": 14},
  {"step_code": "try_in_2", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
  {"step_code": "delivery", "pool": "work", "duration_minutes": 45, "default_days_offset": 7, "requires_precommit": true},
  {"step_code": "control_6m", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
  {"step_code": "control_12m", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
]'::jsonb, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM care_pathways WHERE reason = 'onkológiai kezelés utáni állapot' LIMIT 1);

COMMIT;
