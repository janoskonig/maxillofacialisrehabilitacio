-- Migration: Add custom_label to episode_steps for ad-hoc step labels.
-- Idempotent: safe to run multiple times.
-- Run with: psql -d <db> -f database/migration_episode_steps_custom_label.sql

BEGIN;

ALTER TABLE episode_steps ADD COLUMN IF NOT EXISTS custom_label VARCHAR(200);

COMMENT ON COLUMN episode_steps.custom_label IS 'User-provided label for ad-hoc steps (source_episode_pathway_id IS NULL). Takes precedence over step_catalog lookup.';

COMMIT;
