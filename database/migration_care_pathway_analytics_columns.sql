-- Migration: extend care_pathway_analytics with n_episodes, is_insufficient_sample
-- Run with: psql -d <db> -f database/migration_care_pathway_analytics_columns.sql
-- Idempotent: safe to run multiple times

BEGIN;

ALTER TABLE care_pathway_analytics ADD COLUMN IF NOT EXISTS n_episodes INT;
ALTER TABLE care_pathway_analytics ADD COLUMN IF NOT EXISTS is_insufficient_sample BOOLEAN DEFAULT false;

COMMENT ON COLUMN care_pathway_analytics.n_episodes IS 'Number of closed episodes used for calibration';
COMMENT ON COLUMN care_pathway_analytics.is_insufficient_sample IS 'True when n_episodes < Nmin (e.g. 10)';

COMMIT;
