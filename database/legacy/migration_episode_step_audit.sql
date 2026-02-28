-- Migration: episode_step_audit table for tracking manual skip/unskip actions.
-- Idempotent: safe to run multiple times.
-- Run with: psql -d <db> -f database/migration_episode_step_audit.sql

BEGIN;

CREATE TABLE IF NOT EXISTS episode_step_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_step_id UUID NOT NULL REFERENCES episode_steps(id) ON DELETE CASCADE,
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    old_status VARCHAR(20) NOT NULL,
    new_status VARCHAR(20) NOT NULL,
    changed_by VARCHAR(255) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_step_audit_episode
    ON episode_step_audit (episode_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_episode_step_audit_step
    ON episode_step_audit (episode_step_id, created_at DESC);

COMMENT ON TABLE episode_step_audit IS 'Append-only audit log for episode step status changes (skip/unskip).';

COMMIT;
