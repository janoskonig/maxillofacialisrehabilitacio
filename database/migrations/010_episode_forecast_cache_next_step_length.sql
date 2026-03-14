-- Migration: episode_forecast_cache.next_step column extended to support long step_code values
-- Reason: pathway step_code can exceed 50 chars (e.g. slugifyLabel(label)_idx), causing "value too long for type character varying(50)"
-- Run with: npm run migrate or psql -d <db> -f database/migrations/010_episode_forecast_cache_next_step_length.sql

ALTER TABLE episode_forecast_cache
  ALTER COLUMN next_step TYPE VARCHAR(255);
