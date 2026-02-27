-- Migration: episode_forecast_cache for batch forecast API
-- Run with: psql -d <db> -f database/migration_episode_forecast_cache.sql
-- Idempotent: safe to run multiple times

BEGIN;

CREATE TABLE IF NOT EXISTS episode_forecast_cache (
  episode_id UUID PRIMARY KEY REFERENCES patient_episodes(id) ON DELETE CASCADE,
  completion_end_p50 TIMESTAMPTZ,
  completion_end_p80 TIMESTAMPTZ,
  remaining_visits_p50 INT,
  remaining_visits_p80 INT,
  next_step VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'blocked')),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inputs_hash CHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_episode_forecast_cache_computed
  ON episode_forecast_cache(computed_at);

COMMENT ON TABLE episode_forecast_cache IS 'Cached episode forecast: completion window, remaining visits. Invalidated by inputs_hash.';

COMMIT;
