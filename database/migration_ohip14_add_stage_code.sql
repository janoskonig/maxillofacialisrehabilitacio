-- Migration: Add stage_code to ohip14_responses (stádium a mérés pillanatában)
-- Minden etiológia (onkológiai, traumás, veleszületett) esetén STAGE_0..STAGE_7
-- Run with: psql -d <db> -f database/migration_ohip14_add_stage_code.sql

BEGIN;

ALTER TABLE ohip14_responses
  ADD COLUMN IF NOT EXISTS stage_code VARCHAR(50);

COMMENT ON COLUMN ohip14_responses.stage_code IS 'Stádium kód a mérés pillanatában (STAGE_0..STAGE_7), minden etiológiánál ugyanaz a kódrendszer.';

-- Backfill: meglévő soroknál timepoint alapján becsült érték
UPDATE ohip14_responses
SET stage_code = CASE timepoint
  WHEN 'T0' THEN 'STAGE_0'
  WHEN 'T1' THEN 'STAGE_0'
  WHEN 'T2' THEN 'STAGE_7'
  ELSE 'STAGE_0'
END
WHERE stage_code IS NULL;

COMMIT;
